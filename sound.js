// 호박 고누 소리: 파일 없이 코드로 만드는 8비트 소리 (국악 5음계 가락)
// 쓰는 법: Sound.unlock() 을 첫 터치 때 한 번, Sound.play('move_pumpkin'), Sound.bgm('home' | 'game' | null)
const LS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };

let ctx = null, master, sfxBus, bgmBus;
const state = { sfx: LS('hobak:sfx', true), bgm: LS('hobak:bgm', false), track: null };
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    bgmBus = ctx.createGain(); bgmBus.gain.value = 0.32; bgmBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (state.bgm && state.track && !seq) bgm(state.track);
}

// ---------- 소리 재료 ----------
function tone(freq, dur, { type = 'square', vol = 0.2, to = null, at = 0, bus = sfxBus, attack = 0.005, release = 0.06 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.02);
}
let noiseBuf = null;
function noise(dur, { vol = 0.2, at = 0, freq = 2000, q = 1, to = null, bus = sfxBus, type = 'bandpass' } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
const seqNotes = (notes, step, opt) => notes.forEach((n, i) => n && tone(midi(n), step * 0.95, { ...opt, at: (opt.at || 0) + i * step }));

// ---------- 효과음 ----------
const SFX = {
  click: () => tone(1200, 0.04, { vol: 0.08 }),
  select: () => tone(midi(76), 0.07, { vol: 0.12, to: midi(81) }),
  move_pumpkin: () => { tone(160, 0.09, { type: 'triangle', vol: 0.35, to: 300 }); tone(300, 0.07, { type: 'triangle', vol: 0.22, to: 220, at: 0.09 }); },
  move_wisp: () => { noise(0.22, { vol: 0.18, freq: 700, to: 3200, q: 2 }); tone(midi(79), 0.14, { type: 'sine', vol: 0.12, to: midi(86), at: 0.03 }); },
  myturn: () => seqNotes([72, 79], 0.09, { vol: 0.1 }),
  tick: () => tone(1800, 0.025, { vol: 0.1 }),
  found: () => seqNotes([60, 62, 64, 67, 72], 0.07, { vol: 0.12 }),
  win: () => { seqNotes([69, 72, 74, 76, 79, 81], 0.1, { vol: 0.13 }); tone(midi(81), 0.5, { vol: 0.12, at: 0.6 }); tone(midi(69), 0.5, { type: 'triangle', vol: 0.25, at: 0.6 }); },
  lose: () => seqNotes([67, 64, 62, 57], 0.22, { type: 'triangle', vol: 0.3 }),
  draw: () => seqNotes([69, 64, 69], 0.16, { type: 'triangle', vol: 0.28 }),
  levelup: () => { seqNotes([81, 84, 86, 88, 93, 96], 0.05, { vol: 0.09 }); noise(0.5, { vol: 0.06, freq: 8000, q: 0.7, at: 0.25, type: 'highpass' }); },
  stuck: () => tone(midi(64), 0.3, { type: 'triangle', vol: 0.25, to: midi(57) }),
};
function play(name) {
  if (!state.sfx || !ctx || !SFX[name]) return;
  if (ctx.state === 'suspended') ctx.resume();
  SFX[name]();
}

// ---------- 배경음악: 국악 5음계(라 도 레 미 솔) 8비트 ----------
const A3 = 57;
// [음, 박] — 0은 쉼
const TRACKS = {
  // 첫 화면·기다릴 때: 세마치처럼 3박, 잔잔하게
  home: {
    bpm: 92, beats: 3,
    lead: [[76, 2], [74, 1], [72, 1], [74, 1], [76, 1], [69, 3],
           [72, 2], [74, 1], [76, 1], [79, 1], [76, 1], [74, 3],
           [76, 2], [79, 1], [81, 2], [79, 1], [76, 1], [74, 1], [72, 1], [74, 3],
           [72, 1], [69, 1], [67, 1], [69, 3]],
    bass: [45, 45, 45, 48, 48, 50, 45, 43, 45, 52, 43, 45],
    lead_type: 'triangle', lead_vol: 0.16,
    drum: b => (b === 0 ? 'dung' : 'deok'),
  },
  // 대전 중: 4박, 경쾌하게
  game: {
    bpm: 132, beats: 4,
    lead: [[69, .5], [72, .5], [74, .5], [76, .5], [79, 1], [76, 1],
           [74, .5], [76, .5], [74, .5], [72, .5], [69, 2],
           [72, .5], [74, .5], [76, .5], [79, .5], [81, 1], [79, .5], [76, .5],
           [74, 1], [76, .5], [74, .5], [72, 1], [74, 1],
           [69, .5], [72, .5], [74, .5], [76, .5], [79, 1], [76, 1],
           [79, .5], [76, .5], [74, .5], [72, .5], [74, 2],
           [76, .5], [79, .5], [81, .5], [79, .5], [76, .5], [74, .5], [72, .5], [74, .5],
           [69, 3], [0, 1]],
    bass: [45, 45, 48, 50, 45, 48, 50, 45],
    lead_type: 'square', lead_vol: 0.07,
    drum: b => (b === 0 || b === 2 ? 'dung' : 'deok'),
  },
};

let seq = null, seqTrack = null;
function startSeq() {
  stopSeq();
  const tr = TRACKS[state.track]; if (!tr || !ctx) return;
  const spb = 60 / tr.bpm;
  // 가락을 박 단위 시간표로
  const events = []; let pos = 0;
  for (const [n, d] of tr.lead) { if (n) events.push([pos, n, d]); pos += d; }
  const loopBeats = pos;
  let t0 = ctx.currentTime + 0.1, beatDone = 0, evIdx = 0, loop = 0;
  seq = setInterval(() => {
    const ahead = ctx.currentTime + 0.25;
    while (true) {
      // 다음에 올 것: 박(장구·베이스) 또는 가락 음
      const nextBeatT = t0 + beatDone * spb;
      const ev = events[evIdx];
      const nextEvT = ev ? t0 + (loop * loopBeats + ev[0]) * spb : Infinity;
      const tNext = Math.min(nextBeatT, nextEvT);
      if (tNext > ahead) break;
      const at = Math.max(0, tNext - ctx.currentTime);
      if (nextBeatT <= nextEvT) {
        const bInBar = beatDone % tr.beats, bar = Math.floor(beatDone / tr.beats) % tr.bass.length;
        const root = tr.bass[bar];
        if (bInBar === 0) tone(midi(root), spb * 0.9, { type: 'triangle', vol: 0.3, at, bus: bgmBus });
        else tone(midi(root + 12), spb * 0.45, { type: 'triangle', vol: 0.18, at, bus: bgmBus });
        if (tr.drum(bInBar) === 'dung') { tone(120, 0.14, { type: 'sine', vol: 0.4, to: 55, at, bus: bgmBus }); noise(0.05, { vol: 0.05, freq: 300, at, bus: bgmBus }); }
        else noise(0.04, { vol: 0.07, freq: 4500, q: 3, at, bus: bgmBus });
        beatDone++;
      } else {
        tone(midi(ev[1]), ev[2] * spb * 0.9, { type: tr.lead_type, vol: tr.lead_vol, at, bus: bgmBus, release: 0.08 });
        evIdx++;
        if (evIdx >= events.length) { evIdx = 0; loop++; }
      }
    }
  }, 50);
}
function stopSeq() { if (seq) { clearInterval(seq); seq = null; seqTrack = null; } }

function bgm(track) {
  state.track = track;
  if (!state.bgm || !ctx || !track) { stopSeq(); return; }
  if (seq && seqTrack === track) return;
  startSeq(); if (seq) seqTrack = track;
}

export const Sound = {
  unlock, play, bgm,
  get sfx() { return state.sfx; }, get music() { return state.bgm; },
  setSfx(on) { state.sfx = on; SAVE('hobak:sfx', on); if (on) play('click'); },
  setMusic(on) { state.bgm = on; SAVE('hobak:bgm', on); if (on) { unlock(); const t = state.track; state.track = null; bgm(t || 'home'); } else stopSeq(); },
};
