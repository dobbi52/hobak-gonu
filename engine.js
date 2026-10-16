// 호박 고누 규칙 엔진 (화면·서버와 무관한 순수 함수)
// 점 번호: 0 TL, 1 TM, 2 TR (0번 진영) / 3 T, 4 L, 5 C, 6 R, 7 B (원) / 8 BL, 9 BM, 10 BR (1번 진영)
export const HOME = [[0, 1, 2], [8, 9, 10]];
export const EDGES = [
  [0, 1], [1, 2], [1, 3],          // 위 진영과 출구
  [3, 5], [5, 7], [4, 5], [5, 6],  // 가로·세로 지름
  [3, 6], [6, 7], [7, 4], [4, 3],  // 원둘레
  [7, 9], [8, 9], [9, 10],         // 아래 진영과 출구
];
export const MAX_PLY = 60;       // 한 사람당 30수
export const TURN_MS = 10000;    // 한 수당 10초

const ADJ = Array.from({ length: 11 }, () => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }
const IS_HOME = new Set([...HOME[0], ...HOME[1]]);

export function startPos() {
  return { 0: [...HOME[0]], 1: [...HOME[1]] };
}

// 한 말이 갈 수 있는 점들
export function targets(pos, player, from) {
  const occ = new Set([...pos[0], ...pos[1]]);
  return ADJ[from].filter(to => {
    if (occ.has(to)) return false;
    if (!IS_HOME.has(from) && IS_HOME.has(to)) return false; // 진영을 나온 말은 다시 못 들어감
    return true;
  });
}

export function legalMoves(pos, player) {
  const out = [];
  for (const from of pos[player]) for (const to of targets(pos, player, from)) out.push([from, to]);
  return out;
}

export function isLegal(pos, player, from, to) {
  return pos[player].includes(from) && targets(pos, player, from).includes(to);
}

// 말을 옮긴 새 판과 결과. result: null(계속) | {winner, reason} | {draw:true, reason}
export function applyMove(pos, player, from, to, ply) {
  const np = { 0: [...pos[0]], 1: [...pos[1]] };
  np[player] = np[player].map(p => (p === from ? to : p));
  const opp = 1 - player;
  const nply = ply + 1;
  let result = null;
  if (legalMoves(np, opp).length === 0) result = { winner: player, reason: 'stuck' };
  else if (nply >= MAX_PLY) result = { draw: true, reason: 'limit' };
  return { pos: np, ply: nply, result };
}
