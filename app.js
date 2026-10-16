import { HOME, EDGES, TURN_MS, MAX_PLY, startPos, targets, legalMoves, isLegal, applyMove } from './engine.js';
import { createNet } from './net.js';

const $ = id => document.getElementById(id);
const CHAR = [
  { key: 'pumpkin', name: '호박' },
  { key: 'wisp', name: '도깨비불' },
];
const img = (i, state) => `img/${CHAR[i].key}_${state}.png`;

// 판 좌표 (1번 진영이 아래쪽인 기준)
const XY = [[40, 60], [180, 60], [320, 60], [180, 170], [40, 310], [180, 310], [320, 310], [180, 450], [40, 560], [180, 560], [320, 560]];
const CIRCLE = { cx: 180, cy: 310, r: 140 };
const ARC_EDGES = new Set(['3-6', '6-7', '7-4', '4-3']);

let net, uid;
let myName = '';
let matching = false, hb = null, pairUnsub = null, waitStart = 0;
let G = null; // 진행 중인 게임
let sel = null;
let loop = null;

// ---------- 공통 ----------
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
function modal(id, on) { $(id).classList.toggle('on', on); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('on'));
const norm = pos => ({ 0: [...pos[0]], 1: [...pos[1]] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitConnected(ms) {
  return new Promise(res => {
    let off = () => {};
    const timer = setTimeout(() => { off(); res(false); }, ms);
    off = net.connected(c => { if (c) { clearTimeout(timer); setTimeout(() => off(), 0); res(true); } });
  });
}

// ---------- 시작 ----------
async function boot() {
  try { myName = localStorage.getItem('hobakName') || ''; } catch {}
  $('nick').value = myName;
  $('howBtn').onclick = () => modal('howModal', true);
  $('startBtn').onclick = onStart;
  $('cancelBtn').onclick = cancelMatching;
  $('leaveBtn').onclick = () => { if (G && G.data?.status === 'play') endGame({ winner: 1 - G.idx, reason: 'leave' }); };
  $('againBtn').onclick = () => { modal('resultModal', false); startMatching(); };
  $('homeBtn').onclick = () => { modal('resultModal', false); show('home'); };
  $('startBtn').disabled = true;
  try {
    net = await createNet();
    uid = net.uid;
    if (new URLSearchParams(location.search).has('test')) document.body.insertAdjacentHTML('beforeend', '<div class="testtag">시험 모드</div>');
    $('startBtn').disabled = false;
  } catch (e) {
    console.error(e);
    $('homeErr').textContent = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
  }
  drawBoardBase();
}

function onStart() {
  const n = $('nick').value.trim();
  if (n.length < 2 || n.length > 8) { $('homeErr').textContent = '닉네임은 2~8자로 써 주세요.'; return; }
  $('homeErr').textContent = '';
  myName = n;
  try { localStorage.setItem('hobakName', n); } catch {}
  startMatching();
}
$('nick').addEventListener('input', () => { $('homeErr').textContent = ''; });

// ---------- 매칭 ----------
async function startMatching() {
  show('wait');
  $('waitInfo').textContent = '접속한 친구와 자동으로 짝을 지어요';
  net.online();
  const ok = await waitConnected(8000);
  if (!ok) {
    net.offline();
    show('home');
    $('homeErr').textContent = '지금 접속한 친구가 너무 많아요. 잠시 뒤 다시 눌러 주세요.';
    return;
  }
  matching = true;
  waitStart = Date.now();
  await net.set('pair/' + uid, null);
  pairUnsub = net.on('pair/' + uid, gid => { if (gid) onPaired(gid); });
  await lobbyTick();
  hb = setInterval(lobbyTick, 4000);
}

function stopMatchingListeners() {
  matching = false;
  clearInterval(hb); hb = null;
  if (pairUnsub) { pairUnsub(); pairUnsub = null; }
}

// 대기 자리가 비었으면 내가 앉고, 다른 친구가 기다리고 있으면 짝이 됨
async function lobbyTick() {
  if (!matching) return;
  let taken = null;
  try {
    await net.tx('lobby', cur => {
      taken = null;
      const now = net.now();
      if (cur && cur.uid !== uid && now - cur.t < 15000) { taken = cur; return null; }
      return { uid, name: myName, t: now };
    });
  } catch (e) { console.warn(e); return; }
  if (!matching) return;
  if (taken) {
    stopMatchingListeners();
    await createGame(taken);
  } else if (Date.now() - waitStart > 20000) {
    $('waitInfo').textContent = '아직 접속한 친구가 없어요. 조금만 더 기다려 볼까요?';
  }
}

async function leaveLobby() {
  try { await net.tx('lobby', cur => (cur && cur.uid === uid ? null : cur)); } catch {}
}

async function cancelMatching() {
  stopMatchingListeners();
  await leaveLobby();
  net.offline();
  show('home');
}

async function onPaired(gid) {
  if (!matching) return;
  stopMatchingListeners();
  net.set('pair/' + uid, null);
  leaveLobby();
  joinGame(gid, false);
}

async function createGame(opp) {
  const gid = net.newId();
  const meIdx = Math.random() < 0.5 ? 0 : 1;
  const p = {};
  p[meIdx] = { uid, name: myName };
  p[1 - meIdx] = { uid: opp.uid, name: opp.name };
  const game = { p, pos: startPos(), turn: Math.random() < 0.5 ? 0 : 1, ply: 0, status: 'ready', ready: { [meIdx]: true }, t: net.now() };
  await net.set('games/' + gid, game);
  await net.set('pair/' + opp.uid, gid);
  joinGame(gid, true);
}

// ---------- 게임 ----------
function joinGame(gid, creator) {
  G = { gid, creator, idx: null, data: null, readyBy: Date.now() + 10000, shownPly: -1, ended: false, pieceEls: null };
  G.unsub = net.on('games/' + gid, onGame);
  clearInterval(loop);
  loop = setInterval(tick, 150);
}

function closeGame() {
  if (!G) return;
  G.unsub && G.unsub();
  clearInterval(loop); loop = null;
  G = null;
}

async function requeue(msg) {
  closeGame();
  if (msg) toast(msg);
  await sleep(300);
  startMatching();
}

function onGame(g) {
  if (!G || !g) return;
  const first = !G.data;
  G.server = g;
  if (G.pending != null && g.status === 'play' && g.ply < G.pending) return; // 내가 방금 둔 수가 아직 반영 전
  G.pending = null;
  G.data = g;
  G.idx = g.p[0].uid === uid ? 0 : 1;
  if (first) setupGameScreen();

  if (g.status === 'ready') { readyStep(); return; }
  if (g.status === 'cancel') { requeue('상대가 들어오지 않아 다시 찾을게요'); return; }

  if (g.status === 'play' && G.shownPly === -1) {
    show('game');
    for (const id of ['meClock', 'oppClock']) $(id).textContent = '';
    hint(g.turn === G.idx ? '내가 먼저!' : '상대가 먼저!');
  }
  render();
  if (g.status === 'done' && !G.ended) {
    G.ended = true;
    setTimeout(showResult, 700);
  }
}

// 둘 다 들어왔는지 확인하고, 만든 쪽이 게임을 시작시킴 (주기적으로도 다시 확인)
let readyAt = 0;
function readyStep() {
  const g = G.data;
  if (Date.now() - readyAt < 600) return;
  readyAt = Date.now();
  if (!(g.ready && g.ready[G.idx])) net.set(`games/${G.gid}/ready/${G.idx}`, true);
  if (G.creator && g.ready && g.ready[0] && g.ready[1]) {
    net.tx('games/' + G.gid, cur => {
      if (!cur || cur.status !== 'ready') return;
      cur.status = 'play'; cur.turnStart = net.now();
      return cur;
    });
  }
}

function tick() {
  if (!G || !G.data) return;
  const g = G.data;
  const now = net.now();
  if (g.status === 'ready') readyStep();
  if (g.status === 'ready' && Date.now() > G.readyBy) {
    if (G.creator) {
      net.tx('games/' + G.gid, cur => {
        if (!cur || cur.status !== 'ready') return;
        cur.status = 'cancel'; return cur;
      });
      G.readyBy = Infinity;
    } else requeue('상대가 들어오지 않아 다시 찾을게요');
    return;
  }
  if (g.status !== 'play') return;
  const left = Math.max(0, g.turnStart + TURN_MS - now);
  const mine = g.turn === G.idx;
  const sec = Math.ceil(left / 1000);
  $('meClock').textContent = mine ? sec : '';
  $('oppClock').textContent = mine ? '' : sec;
  $('meClock').classList.toggle('low', mine && sec <= 3);
  $('oppClock').classList.toggle('low', !mine && sec <= 3);
  // 시간 초과: 내 차례면 바로, 상대 차례면 여유를 두고 판정 (상대가 나가 버린 경우 대비)
  if (mine && now > g.turnStart + TURN_MS + 300) endGame({ winner: 1 - G.idx, reason: 'timeout' }, g.ply);
  if (!mine && now > g.turnStart + TURN_MS + 2500) endGame({ winner: G.idx, reason: 'timeout' }, g.ply);
}

let ending = false;
async function endGame(result, ply) {
  if (!G || ending) return;
  ending = true;
  const expect = ply ?? G.data.ply;
  try {
    await net.tx('games/' + G.gid, cur => {
      if (!cur || cur.status !== 'play' || cur.ply !== expect) return;
      cur.status = 'done'; cur.result = result;
      return cur;
    });
  } catch (e) { console.warn(e); }
  ending = false;
}

let moving = false;
async function doMove(from, to) {
  if (!G || moving) return;
  const g = G.data, idx = G.idx, ply = g.ply;
  if (g.status !== 'play' || g.turn !== idx || !isLegal(norm(g.pos), idx, from, to)) return;
  moving = true;
  sel = null;
  // 누르는 즉시 화면에서 먼저 움직임 (서버 저장은 뒤에서)
  const r0 = applyMove(norm(g.pos), idx, from, to, ply);
  G.pending = r0.ply;
  G.data = { ...g, pos: r0.pos, ply: r0.ply, turn: 1 - idx, turnStart: net.now() };
  moving = false;
  render();
  let ok = false;
  try {
    const res = await net.tx('games/' + G.gid, cur => {
      if (!cur || cur.status !== 'play' || cur.turn !== idx || cur.ply !== ply) return;
      const pos = norm(cur.pos);
      if (!isLegal(pos, idx, from, to)) return;
      const r = applyMove(pos, idx, from, to, cur.ply);
      cur.pos = r.pos; cur.ply = r.ply; cur.turn = 1 - idx; cur.turnStart = net.now();
      cur.last = { from, to, by: idx };
      if (r.result) { cur.status = 'done'; cur.result = r.result; }
      return cur;
    });
    ok = res.committed;
  } catch (e) { console.warn(e); }
  if (!G) return;
  if (!ok && G.pending != null) {
    // 저장 실패: 서버 상태로 되돌림
    G.pending = null;
    if (G.server) G.data = G.server;
    toast('수를 두지 못했어요');
    render();
  }
}

// ---------- 화면 그리기 ----------
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function xy(n) {
  const [x, y] = XY[n];
  return G && G.idx === 0 ? [360 - x, 620 - y] : [x, y]; // 내 진영이 항상 아래
}

function drawBoardBase() {
  const svg = $('board');
  svg.innerHTML = '';
  const lines = el('g', { id: 'lines' }, svg);
  el('g', { id: 'marks' }, svg);
  el('g', { id: 'pieces' }, svg);
  el('g', { id: 'hits' }, svg);
  for (const [w, c] of [[16, '#120b08'], [9, '#a8774b'], [3, '#d4a473']]) {
    el('circle', { cx: CIRCLE.cx, cy: CIRCLE.cy, r: CIRCLE.r, fill: 'none', stroke: c, 'stroke-width': w }, lines);
    for (const [a, b] of EDGES) {
      if (ARC_EDGES.has(`${a}-${b}`)) continue;
      el('line', { x1: XY[a][0], y1: XY[a][1], x2: XY[b][0], y2: XY[b][1], stroke: c, 'stroke-width': w, 'stroke-linecap': 'square' }, lines);
    }
  }
  // 진영 표시
  for (const y of [60, 560]) el('rect', { x: 14, y: y - 30, width: 332, height: 60, fill: 'none', stroke: '#ffd84a', 'stroke-width': 2, 'stroke-dasharray': '6 6', opacity: .35 }, lines);
  for (let n = 0; n < 11; n++) {
    el('rect', { x: XY[n][0] - 9, y: XY[n][1] - 9, width: 18, height: 18, fill: '#120b08' }, lines);
    el('rect', { x: XY[n][0] - 6, y: XY[n][1] - 6, width: 12, height: 12, fill: '#d4a473' }, lines);
  }
}

function setupGameScreen() {
  const g = G.data, me = G.idx, op = 1 - me;
  // 판 방향: 0번이면 판 전체를 돌려 내 진영을 아래로
  $('lines').setAttribute('transform', me === 0 ? 'rotate(180 180 310)' : '');
  $('meImg').src = img(me, 'idle'); $('oppImg').src = img(op, 'idle');
  $('meName').textContent = g.p[me].name + ' (나)';
  $('oppName').textContent = g.p[op].name;
  $('meInfo').textContent = CHAR[me].name; $('oppInfo').textContent = CHAR[op].name;
  // 말 만들기 (배열 순서가 곧 말 번호)
  const layer = $('pieces'); layer.innerHTML = ''; $('marks').innerHTML = ''; $('hits').innerHTML = '';
  G.pieceEls = { 0: [], 1: [] };
  for (const pl of [0, 1]) {
    for (let k = 0; k < 3; k++) {
      const gEl = el('g', { class: 'pc' }, layer);
      el('ellipse', { cx: 0, cy: 22, rx: 22, ry: 7, fill: '#000', opacity: .45 }, gEl);
      el('rect', { class: 'ring', x: -30, y: -30, width: 60, height: 60, fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '8 6' }, gEl);
      const hop = el('g', { class: 'hopper' }, gEl);
      const im = el('image', { href: img(pl, 'idle'), x: -32, y: -42, width: 64, height: 64, style: 'image-rendering:pixelated' }, hop);
      gEl.addEventListener('click', () => onPieceTap(pl, k));
      G.pieceEls[pl].push({ g: gEl, hop, im, at: null });
    }
  }
  // 빈 점 누르기
  for (let n = 0; n < 11; n++) {
    const [x, y] = xy(n);
    const h = el('circle', { cx: x, cy: y, r: 30, fill: 'transparent' }, $('hits'));
    h.addEventListener('click', () => onNodeTap(n));
  }
  $('hits').style.pointerEvents = 'none';
}

function onPieceTap(pl, k) {
  const g = G?.data; if (!g || g.status !== 'play') return;
  if (pl !== G.idx || g.turn !== G.idx) return;
  const at = g.pos[pl][k];
  if (!targets(norm(g.pos), pl, at).length) { toast('이 말은 지금 갈 곳이 없어요', 1500); return; }
  sel = sel === at ? null : at;
  render();
}
function onNodeTap(n) {
  if (sel == null) return;
  const g = G.data;
  const pos = norm(g.pos);
  if (targets(pos, G.idx, sel).includes(n)) doMove(sel, n);
  else if (pos[G.idx].includes(n) && targets(pos, G.idx, n).length) { sel = n; render(); } // 다른 내 말로 바꿔 고르기
  else { sel = null; render(); }
}

function render() {
  if (!G || !G.data || !G.pieceEls) return;
  const g = G.data, pos = norm(g.pos), me = G.idx;
  const myTurn = g.status === 'play' && g.turn === me && !moving;
  if (!myTurn) sel = null;
  const done = g.status === 'done';
  const loser = done && g.result && !g.result.draw ? 1 - g.result.winner : null;
  for (const pl of [0, 1]) {
    pos[pl].forEach((n, k) => {
      const P = G.pieceEls[pl][k];
      const [x, y] = xy(n);
      P.g.style.transform = `translate(${x}px, ${y}px)`;
      if (P.at !== null && P.at !== n) {
        P.im.setAttribute('href', img(pl, 'move'));
        P.hop.classList.remove('go'); void P.hop.getBBox(); P.hop.classList.add('go');
        setTimeout(() => { if (G && !G.ended) P.im.setAttribute('href', img(pl, 'idle')); }, 420);
      }
      P.at = n;
      const can = myTurn && pl === me && targets(pos, pl, n).length > 0;
      P.g.classList.toggle('can', can && sel !== n);
      P.g.classList.toggle('sel', sel === n);
      if (done) P.im.setAttribute('href', img(pl, pl === loser ? 'stuck' : 'idle'));
    });
  }
  // 갈 수 있는 자리 표시
  const marks = $('marks'); marks.innerHTML = '';
  if (sel != null) {
    for (const t of targets(pos, me, sel)) {
      const [x, y] = xy(t);
      el('rect', { class: 'dest', x: x - 16, y: y - 16, width: 32, height: 32, fill: 'rgba(255,216,74,.35)', stroke: '#ffd84a', 'stroke-width': 3 }, marks);
    }
  }
  $('hits').style.pointerEvents = sel != null ? 'auto' : 'none';
  $('meBar').classList.toggle('turn', g.status === 'play' && g.turn === me);
  $('oppBar').classList.toggle('turn', g.status === 'play' && g.turn !== me);
  const leftMine = MAX_PLY / 2 - movesMade(g, me);
  const leftOpp = MAX_PLY / 2 - movesMade(g, 1 - me);
  $('movesInfo').textContent = `남은 수  나 ${leftMine} · 상대 ${leftOpp}`;
  if (g.status === 'play' && G.shownPly !== g.ply) {
    if (G.shownPly !== -1 && g.turn === me) hint('내 차례!', 700);
    G.shownPly = g.ply;
  }
}

// 지금까지 둔 수: 선공은 올림, 후공은 내림
function movesMade(g, pl) {
  const first = g.first ?? firstPlayer(g);
  return pl === first ? Math.ceil(g.ply / 2) : Math.floor(g.ply / 2);
}
function firstPlayer(g) { return g.ply % 2 === 0 ? g.turn : 1 - g.turn; }

function hint(text, ms = 1200) {
  const h = $('hint');
  h.innerHTML = `<span>${text}</span>`;
  clearTimeout(hint.t);
  hint.t = setTimeout(() => (h.innerHTML = ''), ms);
}

function showResult() {
  if (!G) return;
  const g = G.data, me = G.idx, r = g.result || {};
  let title, text, pic;
  if (r.draw) { title = '비겼어요'; pic = 'img/icon_draw.png'; text = '30수 동안 아무도 가두지 못했어요'; }
  else if (r.winner === me) {
    title = '이겼어요!'; pic = 'img/icon_win.png';
    text = { stuck: '상대 말을 모두 가뒀어요', timeout: '상대가 시간 안에 두지 못했어요', leave: '상대가 기권했어요' }[r.reason] || '';
  } else {
    title = '졌어요'; pic = img(me, 'stuck');
    text = { stuck: '내 말이 모두 갇혔어요', timeout: '시간 안에 두지 못했어요', leave: '기권했어요' }[r.reason] || '';
  }
  for (const id of ['meClock', 'oppClock']) $(id).textContent = '';
  for (const id of ['meT', 'oppT']) $(id).style.transform = 'scaleX(0)';
  $('resImg').src = pic; $('resTitle').textContent = title; $('resText').textContent = text;
  $('resTitle').style.color = r.draw ? 'var(--ink)' : r.winner === me ? 'var(--gold)' : '#9fd7ff';
  modal('resultModal', true);
  closeGame();
  setTimeout(() => { if (!matching && !G) net.offline(); }, 1500);
}

// 시간 막대는 화면 새로 그릴 때마다 부드럽게
(function frame() {
  if (G && G.data && G.data.status === 'play') {
    const g = G.data, mine = g.turn === G.idx;
    const f = Math.max(0, Math.min(1, (g.turnStart + TURN_MS - net.now()) / TURN_MS));
    $('meT').style.transform = `scaleX(${mine ? f : 0})`;
    $('oppT').style.transform = `scaleX(${mine ? 0 : f})`;
  }
  requestAnimationFrame(frame);
})();
boot();
