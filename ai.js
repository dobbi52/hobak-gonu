// 컴퓨터 상대: 판이 작아서 모든 경우를 처음에 한 번 계산해 둠
import { legalMoves, applyMove } from './engine.js';

const key = (pos, t) => [...pos[0]].sort((a, b) => a - b).join('.') + '|' + [...pos[1]].sort((a, b) => a - b).join('.') + '|' + t;
const play = (pos, t, f, to) => applyMove(pos, t, f, to, 0).pos;

// 둘 차례인 쪽 기준으로 W(이김) / L(짐) / D(끝나지 않음)과 끝날 때까지 수
let SOLVED = null;
function solve(start) {
  const succ = new Map(), info = new Map();
  const stack = [[start, 0], [start, 1]];
  while (stack.length) {
    const [pos, t] = stack.pop();
    const k = key(pos, t);
    if (succ.has(k)) continue;
    const nx = legalMoves(pos, t).map(([f, to]) => { const p = play(pos, t, f, to); return [key(p, 1 - t), p]; });
    succ.set(k, nx.map(x => x[0]));
    for (const [nk, p] of nx) if (!succ.has(nk)) stack.push([p, 1 - t]);
  }
  const pred = new Map([...succ.keys()].map(k => [k, []]));
  for (const [k, ns] of succ) for (const n of ns) pred.get(n).push(k);
  const cnt = new Map([...succ].map(([k, ns]) => [k, ns.length]));
  const q = [];
  for (const [k, ns] of succ) if (!ns.length) { info.set(k, ['L', 0]); q.push(k); }
  while (q.length) {
    const k = q.shift(), [v, d] = info.get(k);
    for (const p of pred.get(k)) {
      if (info.has(p)) continue;
      if (v === 'L') { info.set(p, ['W', d + 1]); q.push(p); }
      else { cnt.set(p, cnt.get(p) - 1); if (!cnt.get(p)) { info.set(p, ['L', d + 1]); q.push(p); } }
    }
  }
  return info;
}
const val = (pos, t) => SOLVED.get(key(pos, t)) || ['D', 0];

const pick = a => a[Math.floor(Math.random() * a.length)];
const winsNow = (pos, t) => legalMoves(pos, t).filter(([f, to]) => !legalMoves(play(pos, t, f, to), 1 - t).length);

// 수를 고름. level: 'easy' | 'normal' | 'hard'
export function chooseMove(pos, t, level, startPos) {
  if (!SOLVED) SOLVED = solve(startPos);
  const moves = legalMoves(pos, t);
  if (!moves.length) return null;
  const after = moves.map(([f, to]) => ({ f, to, p: play(pos, t, f, to) }));

  if (level === 'hard') {
    // 상대가 지는 판(L)으로 가장 빨리 → 무승부 판 → 어쩔 수 없으면 최대한 오래 버팀
    const lose = after.filter(m => val(m.p, 1 - t)[0] === 'L');
    if (lose.length) { const best = Math.min(...lose.map(m => val(m.p, 1 - t)[1])); return pick(lose.filter(m => val(m.p, 1 - t)[1] === best)); }
    const draw = after.filter(m => val(m.p, 1 - t)[0] === 'D');
    if (draw.length) return pick(draw);
    const far = Math.max(...after.map(m => val(m.p, 1 - t)[1]));
    return pick(after.filter(m => val(m.p, 1 - t)[1] === far));
  }

  // 공통: 바로 이길 수 있으면 (쉬움은 가끔 놓침)
  const win = after.filter(m => !legalMoves(m.p, 1 - t).length);
  if (win.length && (level === 'normal' || Math.random() < 0.6)) return pick(win);
  // 한 수 만에 질 자리는 피함
  const safe = after.filter(m => !winsNow(m.p, 1 - t).length);
  const pool = safe.length ? safe : after;
  if (level === 'easy') return pick(pool);

  // 보통: 세 수 앞까지 보고, 상대 말을 덜 움직이게 하는 쪽 (가끔 실수)
  if (Math.random() < 0.15) return pick(pool);
  const score = m => {
    const v = val(m.p, 1 - t);
    if (v[0] === 'L' && v[1] <= 3) return 100 - v[1];   // 세 수 안에 이기는 길
    if (v[0] === 'W' && v[1] <= 3) return -100 + v[1];  // 세 수 안에 지는 길
    return legalMoves(m.p, t).length - legalMoves(m.p, 1 - t).length * 1.5 + Math.random();
  };
  return pool.reduce((a, b) => (score(b) > score(a) ? b : a));
}
