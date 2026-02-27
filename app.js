const $ = (id) => document.getElementById(id);

let ctx = null;
let master = null;

// chordName -> array of voices (each voice is one note)
const activeChords = new Map();

/** A4=440, midi 69 */
function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = +$("vol").value;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

$("vol").addEventListener("input", () => {
  if (!master) return;
  master.gain.setTargetAtTime(+$("vol").value, ctx.currentTime, 0.01);
});

function getOscConfigs() {
  const cfgs = [
    { on: $("o1_on").checked, wave: $("o1_wave").value, vol: +$("o1_vol").value, det: +$("o1_det").value },
    { on: $("o2_on").checked, wave: $("o2_wave").value, vol: +$("o2_vol").value, det: +$("o2_det").value },
    { on: $("o3_on").checked, wave: $("o3_wave").value, vol: +$("o3_vol").value, det: +$("o3_det").value },
  ];
  return cfgs.filter(c => c.on && c.vol > 0);
}

function makeVoice(freqHz) {
  ensureAudio();

  const t = ctx.currentTime;
  const atk = Math.max(0.001, +$("atk").value);
  const rel = Math.max(0.01, +$("rel").value);

  // per-note envelope (단일 노트의 ADSR중 A/R만 쓰는 단순 엔벌로프)
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0, t);
  env.gain.linearRampToValueAtTime(1.0, t + atk);
  env.connect(master);

  const cfgs = getOscConfigs();
  if (cfgs.length === 0) return null;

  const oscs = [];
  for (const c of cfgs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = c.wave;
    osc.frequency.value = freqHz;
    osc.detune.value = c.det; // cents
    g.gain.value = c.vol;

    osc.connect(g);
    g.connect(env);

    osc.start(t);
    oscs.push(osc);
  }

  return { env, oscs, rel };
}

function releaseVoice(voice, when = ctx.currentTime) {
  const t = when;
  const rel = voice.rel;

  voice.env.gain.cancelScheduledValues(t);
  // 현재 값에서 0으로
  voice.env.gain.setValueAtTime(voice.env.gain.value, t);
  voice.env.gain.linearRampToValueAtTime(0.0, t + rel);

  const stopT = t + rel + 0.03;
  for (const osc of voice.oscs) osc.stop(stopT);
}

function playChord(chord) {
  ensureAudio();

  // 같은 코드 연타하면 이전 거 정리하고 다시
  stopChord(chord.name);

  const voices = [];
  for (const midi of chord.midis) {
    const v = makeVoice(midiToHz(midi));
    if (v) voices.push(v);
  }
  if (voices.length === 0) return;

  activeChords.set(chord.name, voices);

  // “연주”가 아니라 버튼형이라, 길이만큼 재생 후 자동 릴리즈
  const lenSec = +$("len").value;
  const offTime = ctx.currentTime + Math.max(0.05, lenSec);
  for (const v of voices) releaseVoice(v, offTime);

  // 맵 정리 (릴리즈 끝나면 삭제)
  const cleanupTime = offTime + (+$("rel").value) + 0.2;
  setTimeout(() => {
    // 혹시 다른 재생으로 덮였으면 삭제하지 않음
    const cur = activeChords.get(chord.name);
    if (cur === voices) activeChords.delete(chord.name);
  }, Math.ceil(cleanupTime * 1000));
}

function stopChord(name) {
  if (!ctx) return;
  const voices = activeChords.get(name);
  if (!voices) return;

  const t = ctx.currentTime;
  for (const v of voices) releaseVoice(v, t);
  activeChords.delete(name);
}

/**
 * 8개 9th chord 세트
 * - maj9: 1 3 5 7 9
 * - m9  : 1 b3 5 b7 9
 * - 9   : 1 3 5 b7 9
 *
 * 아래는 “C기준으로 감성 좋은 진행” 느낌으로 골랐다.
 */
const chords = [
  // name, root midi, intervals
  { name: "Cmaj9",  root: 60, intervals: [0, 4, 7, 11, 14] }, // C E G B D
  { name: "Dm9",    root: 62, intervals: [0, 3, 7, 10, 14] }, // D F A C E
  { name: "Em9",    root: 64, intervals: [0, 3, 7, 10, 14] }, // E G B D F#
  { name: "Fmaj9",  root: 65, intervals: [0, 4, 7, 11, 14] }, // F A C E G
  { name: "G9",     root: 67, intervals: [0, 4, 7, 10, 14] }, // G B D F A
  { name: "Am9",    root: 69, intervals: [0, 3, 7, 10, 14] }, // A C E G B
  { name: "Bbmaj9", root: 70, intervals: [0, 4, 7, 11, 14] }, // Bb D F A C
  { name: "Abmaj9", root: 68, intervals: [0, 4, 7, 11, 14] }, // Ab C Eb G Bb
].map(ch => ({
  ...ch,
  midis: ch.intervals.map(iv => ch.root + iv)
}));

function midiToNoteName(midi) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const n = names[midi % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${n}${oct}`;
}

function renderChordButtons() {
  const wrap = $("chords");

  for (const ch of chords) {
    const btn = document.createElement("button");
    btn.className = "chordBtn";
    btn.type = "button";

    const title = document.createElement("div");
    title.className = "chordName";
    title.textContent = ch.name;

    const notes = document.createElement("div");
    notes.className = "chordNotes";
    notes.textContent = ch.midis.map(midiToNoteName).join("  ");

    btn.appendChild(title);
    btn.appendChild(notes);

    // 버튼 클릭 = 코드 재생 (자동으로 길이만큼)
    btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    triggerWobble(0.2);   // <- 배경 출렁
    flowBackground();
    playChord(ch);
    });

    wrap.appendChild(btn);
  }
}

renderChordButtons();

function rand(min, max){ return Math.random() * (max - min) + min; }
function randPct(){ return `${Math.floor(rand(5,95))}%`; }

function triggerWobble(intensity = 1){
  const b = document.body;

  // 그라데이션 중심 위치 랜덤
  b.style.setProperty("--bx1", randPct());
  b.style.setProperty("--by1", randPct());
  b.style.setProperty("--bx2", randPct());
  b.style.setProperty("--by2", randPct());
  b.style.setProperty("--bx3", randPct());
  b.style.setProperty("--by3", randPct());

  // 강도(투명도) 랜덤
  b.style.setProperty("--bi1", (0.14 + Math.random() * 0.18) * intensity);
  b.style.setProperty("--bi2", (0.10 + Math.random() * 0.16) * intensity);
  b.style.setProperty("--bi3", (0.08 + Math.random() * 0.14) * intensity);

  // 이동/회전 랜덤 (출렁 방향)
  b.style.setProperty("--dx", `${rand(-22, 22) * intensity}px`);
  b.style.setProperty("--dy", `${rand(-18, 18) * intensity}px`);
  b.style.setProperty("--rot", `${rand(-1.1, 1.1) * intensity}deg`);

  // 화면 미세 흔들림
  b.style.setProperty("--jx", `${rand(-4, 4) * intensity}px`);
  b.style.setProperty("--jy", `${rand(-3, 3) * intensity}px`);

  // 애니메이션 재트리거 (class 토글)
  b.classList.remove("wobble");
  // reflow 강제
  void b.offsetWidth;
  b.classList.add("wobble");

  // 끝나면 class 제거(다음 트리거 깔끔)
  clearTimeout(triggerWobble._t);
  triggerWobble._t = setTimeout(() => b.classList.remove("wobble"), 750);
}

function flowBackground(){
  const root = document.documentElement;

  const newHue = Math.floor(Math.random() * 360);
  const newHue2 = (newHue + 120 + Math.random()*60) % 360;

  root.style.setProperty("--hue", newHue);
  root.style.setProperty("--hue2", newHue2);
}