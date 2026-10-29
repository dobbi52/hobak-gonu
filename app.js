import { HOME, EDGES, TURN_MS, MAX_PLY, startPos, targets, legalMoves, isLegal, applyMove } from './engine.js';
import { createNet, countPresence } from './net.js';
import { chooseMove } from './ai.js';
import { Sound } from './sound.js';
import { WORN } from './worn.js';

const $ = id => document.getElementById(id);
const CHAR = [
  { key: 'pumpkin', name: '호박' },
  { key: 'wisp', name: '도깨비불' },
];
// 오늘의 1등은 황금 캐릭터를 쓸 수 있음 (gold: 그 쪽이 황금을 쓰는지)
const imgOf = (i, state, gold) => `img/${gold ? 'g' : ''}${CHAR[i].key}_${state}.png`;
const img = (i, state) => imgOf(i, state, !!(G && G.gold && G.gold[i]));
// 말 그림: 황금이면 황금 그대로, 꾸미기를 썼으면 꾸미기 쓴 그림 (위치·크기가 조금씩 달라서 함께 정함)
function wornOf(charKey, acc, state) { const b = acc && WORN[`${charKey}_${acc}_${state}`]; return b ? { href: `img/worn/${charKey}_${acc}_${state}.png`, box: b } : null; }
function setSprite(P, pl, state) {
  const gold = !!(G && G.gold && G.gold[pl]);
  const acc = !gold && G && G.data && G.data.look && G.data.look[pl] ? G.data.look[pl].a : '';
  const w = wornOf(CHAR[pl].key, acc, state);
  const [href, box] = w ? [w.href, w.box] : [img(pl, state), [-32, -42, 64, 64]];
  P.im.setAttribute('href', href);
  P.im.setAttribute('x', box[0]); P.im.setAttribute('y', box[1]); P.im.setAttribute('width', box[2]); P.im.setAttribute('height', box[3]);
  P.im.setAttribute('preserveAspectRatio', w ? 'none' : 'xMidYMid meet');
  P.state = state;
}

const TEST = new URLSearchParams(location.search).has('test');
// 순위표 서버 (Apps Script 배포 주소)
const APPS_URL = TEST ? '/__apps' : 'https://script.google.com/macros/s/AKfycbx7dbsnBvLazMlwW_5NCKWu9yc62TC9VMcRDyOu-L6Ce2FspWnwLP9hfph_y2v4EFQ2/exec';
const AUTH_SRC = TEST ? '/__arcade-auth.js' : 'https://dobbi52.github.io/games/arcade-auth.js';

// 판 좌표 (1번 진영이 아래쪽인 기준)
const XY = [[40, 60], [180, 60], [320, 60], [180, 170], [40, 310], [180, 310], [320, 310], [180, 450], [40, 560], [180, 560], [320, 560]];
const CIRCLE = { cx: 180, cy: 310, r: 140 };
const ARC_EDGES = new Set(['3-6', '6-7', '7-4', '4-3']);

let net, uid;
const nowMs = () => (net ? net.now() : Date.now());
let myName = '';
let leader = '';     // 오늘 순위표 1등 닉네임 (실시간)
const isLeader = () => { const a = auth(); return !!(a && leader && a.nick === leader); };
const goldOff = () => { try { return localStorage.getItem('hobak:goldOff') === '1'; } catch { return false; } };
const setGoldOff = v => { try { localStorage.setItem('hobak:goldOff', v ? '1' : '0'); } catch {} };
const useGold = () => isLeader() && !goldOff();      // 1등이 되면 처음엔 황금을 쓰는 상태
let myTotal = null;  // 내 누적 기록 {games, w, d, l, acc}

// 등급 (누적 판수)과 꾸미기 (누적 승수)
const TIERS = [[0, '씨앗', 'seed'], [5, '새싹', 'sprout'], [15, '떡잎', 'leaf'], [40, '덩굴', 'vine'], [80, '호박꽃', 'flower'], [150, '큰 호박', 'pumpkin'], [300, '전설의 호박', 'legend']];
const tierIdx = games => { let i = 0; TIERS.forEach((t, k) => { if ((games || 0) >= t[0]) i = k; }); return i; };
const tierImg = i => `img/tier_${TIERS[i][2]}.png`;
const ACCS = [['ribbon', '리본', 3, 44, 31.5], ['straw', '밀짚모자', 10, 55, 31.5], ['glasses', '선글라스', 25, 57, 20.5], ['wizard', '마법사 모자', 50, 51, 44], ['wreath', '꽃 화관', 100, 54, 28]];
const accOf = k => ACCS.find(a => a[0] === k);
const eul = w => w + ((w.charCodeAt(w.length - 1) - 0xAC00) % 28 ? '을' : '를');   // 받침에 따라 을/를
let lastBoard = null, boardErr = '';
let matching = false, hb = null, pairUnsub = null, waitStart = 0;
let G = null; // 진행 중인 게임
let sel = null;
let loop = null;

// ---------- 공통 ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  Sound.bgm(id === 'game' ? 'game' : 'home');
}
// 소리: 브라우저는 화면을 한 번 눌러야 소리를 낼 수 있어서, 누를 때마다 깨움
addEventListener('pointerdown', () => Sound.unlock(), { capture: true });
document.addEventListener('click', e => { if (e.target.closest('.btn, .ai-opt, .deco-item')) Sound.play('click'); }, { capture: true });
function drawSoundBtns() {
  document.querySelectorAll('.sfxT').forEach(b => { b.classList.toggle('off', !Sound.sfx); b.title = '효과음 ' + (Sound.sfx ? '끄기' : '켜기'); b.setAttribute('aria-pressed', Sound.sfx); });
  document.querySelectorAll('.bgmT').forEach(b => { b.classList.toggle('off', !Sound.music); b.title = '배경음악 ' + (Sound.music ? '끄기' : '켜기'); b.setAttribute('aria-pressed', Sound.music); });
}
document.querySelectorAll('.sfxT').forEach(b => b.onclick = () => { Sound.unlock(); Sound.setSfx(!Sound.sfx); drawSoundBtns(); });
document.querySelectorAll('.bgmT').forEach(b => b.onclick = () => { Sound.unlock(); Sound.setMusic(!Sound.music); Sound.bgm($('game').classList.contains('on') ? 'game' : 'home'); drawSoundBtns(); });
drawSoundBtns();
Sound.bgm('home');
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
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
const auth = () => (window.ArcadeAuth ? window.ArcadeAuth.get() : null);
const AUTH_OPTS = { game: 'hobak', gameName: '호박 고누', color: '#ff9a2e' };

function drawAccount() {
  const a = auth();
  $('acctTier').hidden = !(a && myTotal);
  if (a && myTotal) { const ti = tierIdx(myTotal.games); $('acctTier').src = tierImg(ti); $('acctTier').title = TIERS[ti][1]; }
  if (a) {
    $('acctWho').innerHTML = `<b>${esc(a.nick)}</b> 님${myTotal ? ` <span style="color:var(--dim);font-size:12px">${TIERS[tierIdx(myTotal.games)][1]}</span>` : ''}`;
    $('acctBtn').textContent = '계정';
    $('startBtn').textContent = '대전 시작';
  } else {
    $('acctWho').textContent = '생각 오락실 계정으로 해요';
    $('acctBtn').textContent = '로그인';
    $('startBtn').textContent = '로그인하고 시작';
  }
  const meChamp = useGold();
  $('duoA').src = imgOf(0, 'idle', meChamp); $('duoB').src = imgOf(1, 'idle', meChamp);
}
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function boot() {
  $('howBtn').onclick = openHelp;
  $('howPrev').onclick = () => { helpPage--; renderHelp(); };
  $('howNext').onclick = () => { if (helpPage === HELP.length - 1) modal('howModal', false); else { helpPage++; renderHelp(); } };
  let seen = false; try { seen = !!localStorage.getItem('hobak:seenHelp'); } catch {}
  if (!seen) setTimeout(openHelp, 300);
  $('startBtn').onclick = onStart;
  $('acctBtn').onclick = () => window.ArcadeAuth && window.ArcadeAuth.open(AUTH_OPTS);
  $('decoBtn').onclick = openDeco;
  $('cancelBtn').onclick = cancelMatching;
  $('leaveBtn').onclick = () => { if (G && G.data?.status === 'play') endGame({ winner: 1 - G.idx, reason: 'leave', by: G.idx }); };
  $('againBtn').onclick = () => { modal('resultModal', false); if (lastPractice) startPractice(lastPractice); else startMatching(); };
  $('aiBtn').onclick = () => modal('aiModal', true);
  $('waitAiBtn').onclick = async () => { await cancelMatching(); modal('aiModal', true); };
  document.querySelectorAll('.ai-opt').forEach(b => b.onclick = () => { modal('aiModal', false); startPractice(b.dataset.lv); });
  $('homeBtn').onclick = () => { modal('resultModal', false); goHome(); };
  $('startBtn').disabled = true;
  if (TEST) document.body.insertAdjacentHTML('beforeend', '<div class="testtag">시험 모드</div>');
  drawBoardBase();
  loadBoard();
  setInterval(() => { if ($('home').classList.contains('on') && !document.hidden) loadBoard(); }, 60000);
  setInterval(() => { if ($('home').classList.contains('on') && !document.hidden) loadLive(); }, 30000);
  try {
    await loadScript(AUTH_SRC);
    window.ArcadeAuth.onChange(() => { drawAccount(); loadBoard(); });
    drawAccount();
    loadBoard();   // 로그인 정보를 읽은 뒤 내 누적 기록까지 다시 받기
    if (window.ArcadeAuth.refresh) window.ArcadeAuth.refresh();
  } catch (e) {
    console.error(e);
    $('homeErr').textContent = '로그인 기능을 불러오지 못했어요. 새로고침해 주세요.';
    return;
  }
  try {
    net = await createNet();
    uid = net.uid;
    if (TEST) window.__net = net;
    net.connected(c => {
      netOn = c;
      if (c && presState) setPres(presState);   // 다시 연결되면 접속 표시를 다시 남김
      if (c && matching && queueCache && !queueCache[uid]) net.joinQueue(myName).catch(() => {});
      drawNetBar();
    });
    $('startBtn').disabled = false;
    loadLive();
  } catch (e) {
    console.error(e);
    $('homeErr').textContent = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
  }
}

function drawNetBar() { $('netBar').classList.toggle('on', !netOn && !!G && !G.local && !G.ended && !!G.data && G.data.status === 'play'); }
function goHome() { show('home'); drawAccount(); loadBoard(); loadLive(); }
// 첫 화면: 지금 대전 중인 친구 수 (30초마다)
async function loadLive() {
  if (!net) return;
  try {
    const c = await net.countOnline();
    $('liveCount').innerHTML = c.play > 0
      ? `<i></i>지금 <b>${c.play}</b>명 대전 중${c.wait ? ` · <b>${c.wait}</b>명 상대 찾는 중` : ''}`
      : c.wait > 0 ? `<i></i>지금 <b>${c.wait}</b>명이 상대를 찾고 있어요! 들어가면 바로 대전해요`
      : '<i class="off"></i>지금 대전 중인 친구가 없어요';
    $('liveCount').hidden = false;
  } catch (e) {}
}

function onStart() {
  $('homeErr').textContent = '';
  const a = auth();
  if (!a) { window.ArcadeAuth.open({ ...AUTH_OPTS, onPlay: () => onStart() }); return; }
  myName = a.nick;
  startMatching();
}

// ---------- 놀이 방법 (그림 3쪽) ----------
// 작은 판 그림: pcs = {점번호: 'p'|'w'|'pS'|'wS'(우는 모습)}, arrows = [[from, to, ok]]
function miniBoard(pcs, arrows = [], homeMark = [], vb = '-10 0 380 620') {
  const P = n => XY[n];
  let h = `<svg viewBox="${vb}" aria-hidden="true">`;
  h += '<defs><marker id="ah-ok" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#7dff8a"/></marker></defs>';
  for (const y of homeMark) h += `<rect x="14" y="${y - 30}" width="332" height="60" fill="rgba(255,216,74,.08)" stroke="#ffd84a" stroke-width="3" stroke-dasharray="8 7"/>`;
  for (const [w, c] of [[16, '#120b08'], [9, '#a8774b']]) {
    h += `<circle cx="180" cy="310" r="140" fill="none" stroke="${c}" stroke-width="${w}"/>`;
    for (const [a, b] of EDGES) if (!ARC_EDGES.has(`${a}-${b}`)) h += `<line x1="${P(a)[0]}" y1="${P(a)[1]}" x2="${P(b)[0]}" y2="${P(b)[1]}" stroke="${c}" stroke-width="${w}"/>`;
  }
  for (let n = 0; n < 11; n++) h += `<rect x="${P(n)[0] - 8}" y="${P(n)[1] - 8}" width="16" height="16" fill="#d4a473" stroke="#120b08" stroke-width="3"/>`;
  for (const [a, b, ok] of arrows) {
    const [x1, y1] = P(a), [x2, y2] = P(b), L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const sx = x1 + ux * 34, sy = y1 + uy * 34, ex = x2 - ux * (ok ? 30 : 22), ey = y2 - uy * (ok ? 30 : 22);
    if (ok) h += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#7dff8a" stroke-width="9" marker-end="url(#ah-ok)"/>`;
    else {
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      h += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#ff6b5a" stroke-width="8" stroke-dasharray="12 8"/>`;
      h += `<g stroke="#ff6b5a" stroke-width="9"><line x1="${mx - 15}" y1="${my - 15}" x2="${mx + 15}" y2="${my + 15}"/><line x1="${mx + 15}" y1="${my - 15}" x2="${mx - 15}" y2="${my + 15}"/></g>`;
    }
  }
  for (const [n, k] of Object.entries(pcs)) {
    const file = { p: 'pumpkin_idle', w: 'wisp_idle', pS: 'pumpkin_stuck', wS: 'wisp_stuck' }[k];
    h += `<image href="img/${file}.png" x="${P(n)[0] - 36}" y="${P(n)[1] - 46}" width="72" height="72" style="image-rendering:pixelated"/>`;
  }
  return h + '</svg>';
}
const HELP = [
  { t: '규칙', b: () =>
    '<p class="hl">차례대로 말 하나를 <b>선을 따라 한 칸</b> 옮겨요.<br>상대 말이 <b>하나도 못 움직이게</b> 가두면 이겨요!</p>' +
    `<div class="hfig">${miniBoard({ 0: 'wS', 1: 'wS', 3: 'wS', 4: 'p', 5: 'p', 6: 'p' })}</div>` +
    '<p class="cap">호박 3개가 길을 모두 막아서<br>도깨비불이 꼼짝 못 해요. 호박 승리!</p>' },
  { t: '움직이는 법', b: () =>
    '<p class="hl">점선 상자가 내 <b>진영</b>이에요.<br>진영 안에서는 <b>출구 쪽으로만</b> 가요.</p>' +
    `<div class="hfig">${miniBoard({ 8: 'p', 7: 'p', 10: 'p' }, [[8, 9, true], [7, 9, false]], [560], '-10 360 380 245')}</div>` +
    '<p class="cap">양 끝 → 가운데 → 원 순서로 나가요.<br>원으로 나온 말은 <b class="no">다시 못 들어가요.</b></p>' +
    '<ul class="tips"><li><span class="tk pic"><img src="img/pumpkin_move.png" alt=""></span><span>내 말을 누르면 갈 수 있는 자리가 <b>반짝여요</b>. 반짝이는 자리를 누르면 옮겨져요.</span></li></ul>' },
  { t: '시간과 점수', b: () =>
    '<ul class="tips">' +
    '<li><span class="tk">20초</span><span>한 수에 <b>20초</b>! 시간이 지나면 져요.</span></li>' +
    '<li><span class="tk">30</span><span>한 사람당 <b>30수</b>가 지나도 안 끝나면 비겨요.</span></li>' +
    '<li><span class="tk pic"><img src="img/icon_win.png" alt=""></span><span>이기면 <b>3점</b>, 비기면 <b>1점</b>. 오늘의 순위는 밤 12시에 새로 시작해요.</span></li>' +
    '<li><span class="tk pic"><img src="img/gpumpkin_idle.png" alt=""></span><span><b>오늘의 1등</b>은 황금 캐릭터를 쓸 수 있어요! 1등을 빼앗기면 사라져요.</span></li>' +
    '<li><span class="tk pic"><img src="img/wisp_move.png" alt=""></span><span>접속한 친구와 자동으로 짝이 지어져요. 호박이 될지 도깨비불이 될지는 그때그때 달라요.</span></li>' +
    '</ul>' },
];
let helpPage = 0;
function openHelp() { helpPage = 0; renderHelp(); modal('howModal', true); try { localStorage.setItem('hobak:seenHelp', '1'); } catch {} }
function renderHelp() {
  const pg = HELP[helpPage], last = helpPage === HELP.length - 1;
  $('howTitle').textContent = '놀이 방법 · ' + pg.t;
  $('howBody').innerHTML = pg.b();
  $('howDots').innerHTML = HELP.map((_, i) => `<i${i === helpPage ? ' class="on"' : ''}></i>`).join('');
  $('howPrev').hidden = helpPage === 0;
  $('howNext').textContent = last ? '시작하기' : '다음';
}

// ---------- 꾸미기 창 ----------
async function openDeco() {
  if (!auth()) { window.ArcadeAuth && window.ArcadeAuth.open({ ...AUTH_OPTS, onPlay: () => openDeco() }); return; }
  modal('decoModal', true);
  if (myTotal) { drawDeco(); return; }
  // 아직 내 기록을 못 받았으면 창 안에서 불러오기
  $('decoTier').innerHTML = '<div class="ts" style="padding:8px">내 기록을 불러오는 중…</div>';
  $('decoGrid').innerHTML = '';
  await loadBoard();
  if (!$('decoModal').classList.contains('on')) return;
  if (myTotal) drawDeco();
  else $('decoTier').innerHTML = `<div class="ts" style="padding:8px;color:#ff8a7a">내 기록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.<br><small>(${esc(boardErr || '서버 응답 없음')})</small></div>`;
}
function drawDeco() {
  const t = myTotal, ti = tierIdx(t.games), next = TIERS[ti + 1];
  const pct = next ? Math.round((t.games - TIERS[ti][0]) / (next[0] - TIERS[ti][0]) * 100) : 100;
  $('decoTier').innerHTML = `<img src="${tierImg(ti)}" alt=""><div style="flex:1"><div class="tn">${TIERS[ti][1]}</div>
    <div class="ts">누적 ${t.games}판 · ${t.w}승 ${t.d}무 ${t.l}패<br>${next ? `${next[1]}까지 ${next[0] - t.games}판 남았어요` : '가장 높은 등급이에요!'}</div>
    <div class="pb"><i style="width:${pct}%"></i></div></div>`;
  const pv = (k) => ['pumpkin', 'wisp'].map((c, i) => {
    const gold = k === 'gold';
    const S = 36 / 64, ox = i * 36 + 18, oy = 18 + 42 * S;   // 말 그림 좌표 (0,0)이 오는 자리
    const w = !gold && k && wornOf(c, k, 'idle');
    const [src, b] = w ? [w.href, w.box] : [`img/${gold ? 'g' : ''}${c}_idle.png`, [-32, -42, 64, 64]];
    return `<img src="${src}" style="left:${ox + b[0] * S}px;top:${oy + b[1] * S}px;width:${b[2] * S}px;height:${b[3] * S}px;${w ? '' : 'object-fit:contain'}" alt="">`;
  }).join('');
  const items = [['', '안 쓰기', 0], ['gold', '황금', 0]].concat(ACCS.map(a => [a[0], a[1], a[2]]));
  const gold = useGold();
  $('decoGrid').innerHTML = items.map(([k, name, need]) => {
    const isG = k === 'gold';
    const lock = isG ? !isLeader() : t.w < need;
    const on = isG ? gold : !gold && (t.acc || '') === k;
    const rq = on ? '쓰는 중' : isG ? (lock ? '오늘 1등만' : '1등 특권') : lock ? `${need}승부터` : need ? `${need}승 달성` : '';
    return `<button class="deco-item${on ? ' on' : ''}${lock ? ' lock' : ''}" data-k="${k}" ${lock ? 'disabled' : ''}><span class="pv">${pv(k)}</span><span class="nm">${name}</span><span class="rq">${rq}</span></button>`;
  }).join('');
  $('decoGrid').querySelectorAll('.deco-item:not(.lock)').forEach(b => b.onclick = () => equip(b.dataset.k));
}
async function equip(k) {
  const a = auth(); if (!a) return;
  if (k === 'gold') { setGoldOff(false); drawDeco(); drawAccount(); toast('황금 캐릭터로 나가요!', 1500); return; }
  if (isLeader() && !goldOff()) { setGoldOff(true); drawAccount(); }    // 1등이지만 다른 꾸미기를 고름
  if ((myTotal.acc || '') === k) { drawDeco(); return; }
  const prev = myTotal.acc;
  myTotal.acc = k; drawDeco();                      // 먼저 바꿔 보여 주고
  const j = await apps('equip', { nick: a.nick, pin: a.pin, acc: k });
  if (j.ok && j.total) { myTotal = j.total; drawDeco(); toast(k ? eul(accOf(k)[1]) + ' 썼어요' : '꾸미기를 벗었어요', 1500); }
  else { myTotal.acc = prev; drawDeco(); toast(j.error || '바꾸지 못했어요'); }
}

// ---------- 순위표 ----------
async function apps(action, data) {
  if (!APPS_URL) return { ok: false, error: '순위표 준비 중' };
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(APPS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...data }) });
      const j = await r.json();
      if (j.ok || !j.retry) return j;
    } catch (e) {}
    await sleep(1200 * (k + 1));
  }
  return { ok: false, error: '순위표 서버에 연결하지 못했어요' };
}

async function loadBoard() {
  const a = auth();
  const j = await apps('board', { nick: a ? a.nick : '' });
  if (!j.ok) { boardErr = j.error; if (!lastBoard) $('rankList').innerHTML = `<div class="empty">${esc(j.error)}</div>`; return; }
  boardErr = j.mine || !a ? '' : '서버에 누적 기록이 없어요 (새 코드 배포 확인)';
  lastBoard = j;
  leader = j.top && j.top[0] && j.top[0].pts > 0 ? j.top[0].nick : '';
  if (a && j.mine) myTotal = j.mine;
  if (!a) myTotal = null;
  drawBoard(j);
  drawAccount();
}

function drawBoard(j) {
  const a = auth();
  $('rankDay').textContent = j.day ? j.day.slice(5).replace('-', '월 ') + '일 · 승 3점 무 1점' : '';
  const ld = j.top && j.top[0] && j.top[0].pts > 0 ? j.top[0].nick : '';
  $('champLine').innerHTML = `<div class="champ"><img src="img/gpumpkin_idle.png" alt=""><span>${ld ? `지금 1등 <b>${esc(ld)}</b> · 황금 캐릭터를 쓸 수 있어요!` : '오늘 1등이 되면 황금 캐릭터를 쓸 수 있어요!'}<br>1등을 빼앗기면 황금도 넘어가요</span></div>`;
  if (!j.top || !j.top.length) {
    $('rankList').innerHTML = '<div class="empty">아직 오늘 경기가 없어요.<br>첫 승리의 주인공이 되어 보세요!</div>';
    return;
  }
  const row = r => `<li class="${r.rank === 1 ? 'top1' : ''}${a && r.nick === a.nick ? ' me' : ''}"><span class="n">${r.rank}</span><span class="nm"><img class="tier" src="${tierImg(tierIdx(r.games || 0))}" alt="">${esc(r.nick)}</span><span class="wdl">${r.w}승 ${r.d}무 ${r.l}패</span><span class="pt">${r.pts}점</span></li>`;
  let h = j.top.map(row).join('');
  if (j.me && j.me.rank > j.top.length) h += `<li class="gap">⋯</li>` + row(j.me);
  $('rankList').innerHTML = `<ol>${h}</ol>`;
}

async function reportResult(gid) {
  const a = auth();
  if (!a) return;
  $('resScore').textContent = '점수를 기록하는 중…';
  let j = null;
  for (let k = 0; k < 3; k++) {          // 경기 기록이 서버에 늦게 보일 수 있어 몇 번 다시 시도
    j = await apps('report', { nick: a.nick, pin: a.pin, gid });
    if (j.ok || j.code === 'AUTH' || !APPS_URL) break;
    await sleep(1500);
  }
  if (j && j.ok && j.me) {
    let h = `오늘 ${j.me.pts}점 · ${j.me.w}승 ${j.me.d}무 ${j.me.l}패 · ${j.me.rank}위`;
    const wasLeader = isLeader();
    if (j.me.rank === 1 && j.me.pts > 0) leader = j.me.nick; else if (leader === j.me.nick) leader = '';
    if (!wasLeader && isLeader()) { setGoldOff(false); h += '<div class="up"><img src="img/gpumpkin_idle.png" alt="">오늘의 1등! 황금 캐릭터로 나가요</div>'; }
    if (!j.counted && !j.dup && j.pairN > j.pairLimit) h += `<div class="meh">같은 친구와 오늘 ${j.pairN}번째 경기라 점수에 들어가지 않아요</div>`;
    else if (j.counted && !j.longEnough) h += '<div class="meh">10수보다 짧은 경기라 등급 판수에는 들어가지 않아요</div>';
    if (j.before && j.total) {
      const t0 = tierIdx(j.before.games), t1 = tierIdx(j.total.games);
      if (t1 > t0) h += `<div class="up"><img src="${tierImg(t1)}" alt="">${TIERS[t1][1]} 등급이 되었어요!</div>`;
      for (const [k, name, need] of ACCS) if (j.before.w < need && j.total.w >= need) h += `<div class="up"><img src="img/acc_${k}.png" alt="">${eul(name)} 얻었어요! 꾸미기에서 써 보세요</div>`;
      myTotal = j.total;
    }
    $('resScore').innerHTML = h;
    if (h.includes('class="up"')) setTimeout(() => Sound.play('levelup'), 200);
  }
  else if (j && j.code === 'AUTH') $('resScore').textContent = '로그인이 풀려서 점수를 기록하지 못했어요. 다시 로그인해 주세요.';
  else $('resScore').textContent = APPS_URL ? '점수를 기록하지 못했어요' : '';
}

// ---------- 매칭 ----------
// 대기 줄(queue): 기다리는 사람마다 자리 하나. 연결이 끊기면 서버가 저절로 줄에서 뺌.
// 짝짓기는 줄 전체를 한 번에 바꾸는 트랜잭션이라, 여러 명이 동시에 눌러도 겹치지 않음.
let netOn = false, presState = null;
async function startMatching() {
  show('wait');
  lastPractice = null;
  $('waitAiBtn').hidden = true;
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
  setPres('wait');
  if (presUnsub) presUnsub();
  presUnsub = net.on('presence', v => {          // 지금 대전 중인 친구 수 (나는 빼고)
    const others = { ...(v || {}) }; delete others[uid];
    waitPlayers = countPresence(others);
    drawWaitInfo();
  });
  await net.joinQueue(myName).catch(e => console.warn(e));
  pairUnsub = net.on('queue', onQueue);
  hb = setInterval(() => {
    if (!matching) return;
    if (netOn) net.beatQueue().catch(() => {});
    tryMatch();
    if (Date.now() - waitStart > 20000) { drawWaitInfo(); $('waitAiBtn').hidden = false; }
  }, 4000);
}

let presUnsub = null, waitPlayers = null;
function setPres(s) { presState = s; if (s) net.setPresence(s).catch(() => {}); }
function drawWaitInfo() {
  if (!matching) return;
  const n = waitPlayers ? waitPlayers.play : 0;
  $('waitInfo').textContent = n > 0
    ? `지금 ${n}명이 대전 중이에요. 판이 끝나면 짝이 될 수 있어요!`
    : Date.now() - waitStart > 20000 ? '지금 접속한 친구가 없어요. 컴퓨터와 연습하며 기다려 볼까요?' : '접속한 친구와 자동으로 짝을 지어요';
}
function stopMatchingListeners() {
  matching = false;
  if (presUnsub) { presUnsub(); presUnsub = null; }
  clearInterval(hb); hb = null;
  if (pairUnsub) { pairUnsub(); pairUnsub = null; }
  clearTimeout(tryT);
}

let queueCache = null, tryT = null, trying = false;
function onQueue(q) {
  if (!matching) return;
  queueCache = q;
  const me = q && q[uid];
  if (me && me.m) { onMatched(me); return; }
  if (!me && netOn) net.joinQueue(myName).catch(() => {});   // 다시 연결됐는데 줄에서 빠져 있으면 다시 섬
  clearTimeout(tryT);
  tryT = setTimeout(tryMatch, 200 + Math.random() * 400);       // 여럿이 동시에 시도하지 않게 조금씩 어긋나게
}

// 줄에서 가장 오래 기다린 친구와 짝을 지음 (나와 상대 자리에 같은 게임 번호를 적음)
async function tryMatch() {
  if (!matching || trying || !netOn) return;
  const q = queueCache || {};
  const me = q[uid];
  if (!me || me.m) return;
  const hasOther = Object.entries(q).some(([k, v]) => k !== uid && v && v.n && !v.m && v.n !== myName);
  if (!hasOther) return;
  trying = true;
  const gid = net.newId();
  try {
    await net.tx('queue', cur => {
      if (!cur) return;
      const m = cur[uid];
      if (!m || m.m) return;
      const now = nowMs();
      const c = Object.entries(cur)
        .filter(([k, v]) => k !== uid && v && v.n && !v.m && v.n !== myName && now - (v.h || v.t || 0) < 30000)
        .sort((a, b) => (a[1].t || 0) - (b[1].t || 0))[0];
      if (!c) return;
      const [ok, ov] = c;
      m.m = gid; m.c = 1; m.o = ok; m.on = ov.n;
      ov.m = gid; ov.c = 0;
      return cur;
    });
  } catch (e) { console.warn(e); }
  trying = false;
}

async function onMatched(me) {
  stopMatchingListeners();
  net.set('queue/' + uid, null).catch(() => {});
  if (me.c) await createGame(me.m, { uid: me.o, name: me.on });
  else joinGame(me.m, false);
}

async function cancelMatching() {
  stopMatchingListeners();
  await net.set('queue/' + uid, null).catch(() => {});
  // 그 사이에 짝이 지어졌으면 상대는 기다리다 다시 찾게 됨
  presState = null;
  net.offline();
  goHome();
}

async function createGame(gid, opp) {
  const meIdx = Math.random() < 0.5 ? 0 : 1;
  const p = {};
  p[meIdx] = { uid, name: myName };
  p[1 - meIdx] = { uid: opp.uid, name: opp.name };
  const game = { p, look: { [meIdx]: myLook() }, pos: startPos(), turn: Math.random() < 0.5 ? 0 : 1, ply: 0, status: 'ready', ready: { [meIdx]: true }, t: nowMs() };
  joinGame(gid, true);
  await net.set('games/' + gid, game).catch(e => console.warn(e));
}

// ---------- 감정 표현 ----------
const EMO = [['hi', '잘 부탁해!'], ['good', '좋은 수다!'], ['oops', '으악, 어렵다…'], ['think', '고민 중이야…'], ['clap', '잘했어!'], ['again', '한 판 더 할래?']];
const emoLabel = k => (EMO.find(e => e[0] === k) || [k, ''])[1];
let emoCool = 0;
const bubTimer = {};
function showBubble(side, k, text, who) {
  const b = $(side === 'me' ? 'bubMe' : 'bubOpp');
  b.innerHTML = `<img src="img/emo/${k}.png" alt=""><span>${who ? `<b>${esc(who)}</b>` : ''}${esc(text)}</span>`;
  const bar = $(side === 'me' ? 'meBar' : 'oppBar');
  b.classList.remove('on');
  if (side === 'me') { b.style.top = ''; b.style.top = (bar.offsetTop - b.offsetHeight - 14) + 'px'; }
  else b.style.top = (bar.offsetTop + bar.offsetHeight + 14) + 'px';
  void b.offsetWidth; b.classList.add('on');
  Sound.play('select');
  clearTimeout(bubTimer[side]);
  bubTimer[side] = setTimeout(() => b.classList.remove('on'), Math.max(2600, text.length * 160));
}
function hideBubbles() { for (const id of ['bubMe', 'bubOpp']) $(id).classList.remove('on'); }
function drawEmoPan() {
  $('emoGrid').innerHTML = EMO.map(([k, t]) => `<button data-k="${k}"><img src="img/emo/${k}.png" alt="">${t}</button>`).join('');
  $('emoGrid').querySelectorAll('button').forEach(b => b.onclick = () => sendEmote(b.dataset.k));
  try { $('emoHide').checked = localStorage.getItem('hobak:emoHide') === '1'; } catch {}
}
$('emoBtn').onclick = e => { e.stopPropagation(); const p = $('emoPan'); p.hidden = !p.hidden; if (!p.hidden) drawEmoPan(); };
$('emoHide').onchange = () => { try { localStorage.setItem('hobak:emoHide', $('emoHide').checked ? '1' : '0'); } catch {} if ($('emoHide').checked) $('bubOpp').classList.remove('on'); };
document.addEventListener('click', e => { if (!e.target.closest('#emoPan, #emoBtn')) $('emoPan').hidden = true; });
const emoHidden = () => { try { return localStorage.getItem('hobak:emoHide') === '1'; } catch { return false; } };
function sendEmote(k) {
  if (!G || !G.data || Date.now() < emoCool) return;
  emoCool = Date.now() + 3000;                       // 3초에 한 번
  $('emoPan').hidden = true;
  showBubble('me', k, emoLabel(k));
  if (G.local) { aiReply(k); return; }
  net.set(`games/${G.gid}/emote/${G.idx}`, { k, n: Date.now() }).catch(() => {});
}
// 상대가 보낸 감정 표현 받기
function checkEmote(g) {
  const e = g.emote && g.emote[1 - G.idx];
  if (G.emoSeen === undefined) { G.emoSeen = e ? e.n : null; return; }   // 들어오기 전에 보낸 것은 무시
  if (!e || e.n === G.emoSeen) return;
  G.emoSeen = e.n;
  if (emoHidden() || !EMO.some(x => x[0] === e.k)) return;
  showBubble('opp', e.k, emoLabel(e.k));
}

// ---------- 컴퓨터 도깨비의 말 ----------
const AI_LINES = {
  easy: { start: ['hi', '놀자 놀자! 잘 부탁해~'], oops: ['oops', '히잉, 그 수는 몰랐어!'], adv: ['good', '에헤헤, 이제 내가 막을 거야~'], think: ['think', '천천히 해도 돼~'],
    win: ['again', '또 놀자~ 한 판 더?'], lose: ['clap', '우와아, 잘한다!'], draw: ['hi', '비겼다! 재밌었어~'] },
  normal: { start: ['hi', '흐흐, 어디 한번 해 볼까?'], oops: ['oops', '앗, 그 수는 몰랐어!'], adv: ['good', '이제 내 차례지롱~'], think: ['think', '천천히 생각해도 돼~'],
    win: ['again', '한 판 더 할래?'], lose: ['clap', '우와, 잘했어!'], draw: ['hi', '비겼네! 다음엔 내가 이길 거야~'] },
  hard: { start: ['hi', '호박 고누라면 자신 있지. 덤벼 보거라!'], oops: ['oops', '호오… 제법이구나!'], adv: ['good', '이제 길이 막혀 갈 게다.'], think: ['think', '서두를 것 없다. 천천히 두거라.'],
    win: ['again', '한 판 더 겨뤄 보겠느냐?'], lose: ['clap', '허허, 나를 이기다니! 대단하구나!'], draw: ['hi', '비기다니, 제법이구나!'] },
};
const AI_REPLY = { hi: ['hi', '반가워!'], good: ['clap', '헤헤, 고마워!'], oops: ['think', '흐흐, 어려울걸?'], think: ['think', '나도 고민 중…'], clap: ['hi', '고마워!'], again: ['again', '좋아, 또 하자!'] };
function aiSay(ev) {
  if (!G || !G.local) return;
  const [k, text] = AI_LINES[G.level][ev];
  showBubble('opp', k, text, AI_LV[G.level]);
}
function aiReply(k) {
  const token = G;
  setTimeout(() => { if (G === token && G.data.status === 'play' && AI_REPLY[k]) showBubble('opp', AI_REPLY[k][0], AI_REPLY[k][1], AI_LV[G.level]); }, 1100);
}

// ---------- 컴퓨터와 연습 (서버 없이 이 기기 안에서만) ----------
const AI_LV = { easy: '아기 도깨비', normal: '도깨비', hard: '도깨비 대장' };
const AI_LV_NAME = { easy: '쉬움', normal: '보통', hard: '어려움' };
let lastPractice = null;
function startPractice(level) {
  closeGame();
  const me = Math.random() < 0.5 ? 0 : 1, a = auth();
  const p = { [me]: { uid: 'me', name: a ? a.nick : '나' }, [1 - me]: { uid: 'ai', name: AI_LV[level] } };
  const look = { [me]: myLook(), [1 - me]: { t: 0, a: level === 'hard' ? 'wizard' : '', g: false } };
  G = { gid: null, local: true, level, meIdx: me, idx: me, data: null, shownPly: -1, ended: false, pieceEls: null };
  clearInterval(loop);
  loop = setInterval(tick, 150);
  setLocal({ p, look, pos: startPos(), turn: Math.random() < 0.5 ? 0 : 1, ply: 0, status: 'play', turnStart: nowMs() + 800, t: nowMs() });
  $('oppInfo').textContent = '컴퓨터 · ' + AI_LV_NAME[level];
  G.said = { oops: 0, adv: 0, think: -1 };
  const token = G;
  setTimeout(() => { if (G === token) aiSay('start'); }, 1300);
}
function setLocal(state) {
  onGame(state);
  if (!G || !G.local || state.status !== 'play' || state.turn === G.idx) return;
  const token = G, ai = state.turn;
  setTimeout(() => {           // 생각하는 척 0.6~1.2초
    if (G !== token || G.data.status !== 'play' || G.data.turn !== ai) return;
    const m = chooseMove(norm(G.data.pos), ai, G.level, startPos());
    if (m) localMove(ai, m.f, m.to);
  }, 600 + Math.random() * 600);
}
function localMove(who, from, to) {
  const g = G.data;
  if (g.status !== 'play' || g.turn !== who || !isLegal(norm(g.pos), who, from, to)) return;
  const r = applyMove(norm(g.pos), who, from, to, g.ply);
  const next = { ...g, pos: r.pos, ply: r.ply, turn: 1 - who, turnStart: nowMs(), last: { from, to, by: who } };
  if (r.result) { next.status = 'done'; next.result = r.result; }
  setLocal(next);
  // 도깨비가 상황 보고 한마디 (한 판에 종류마다 두 번까지)
  if (!r.result && G && G.local) {
    const me = G.idx, ai = 1 - me;
    if (who === me && legalMoves(r.pos, ai).length <= 1 && G.said.oops < 2) { G.said.oops++; setTimeout(() => aiSay('oops'), 350); }
    else if (who === ai && legalMoves(r.pos, me).length <= 1 && G.said.adv < 2) { G.said.adv++; setTimeout(() => aiSay('adv'), 450); }
  }
}

// ---------- 게임 ----------
function joinGame(gid, creator) {
  G = { gid, creator, idx: null, data: null, readyBy: Date.now() + 15000, shownPly: -1, ended: false, pieceEls: null, seenPly: -1, seenAt: 0, oppOn: true, oppOffAt: 0 };
  G.unsub = net.on('games/' + gid, onGame);
  clearInterval(loop);
  loop = setInterval(tick, 150);
}

function closeGame() {
  if (!G) return;
  G.unsub && G.unsub();
  G.oppUnsub && G.oppUnsub();
  clearInterval(loop); loop = null;
  G = null;
  drawNetBar();
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
  G.idx = G.local ? G.meIdx : g.p[0].uid === uid ? 0 : 1;
  if (first) setupGameScreen();
  else if (G.pieceEls) applyGold();
  if (first && !G.local) {
    // 상대 접속 상태: 연결이 끊기면 서버가 접속 표시를 지움
    G.oppUnsub = net.on('presence/' + g.p[1 - G.idx].uid, v => {
      if (!G) return;
      const on = !!v;
      if (G.oppOn && !on) G.oppOffAt = Date.now();
      G.oppOn = on;
    });
  }
  // 이번 차례가 시작된 때는 각자 자기 시계로 잼 (기기마다 시계가 달라도 괜찮게)
  if (g.status === 'play' && g.ply !== G.seenPly) { G.seenPly = g.ply; G.seenAt = Date.now(); }
  if (!G.local) checkEmote(g);

  if (g.status === 'ready') { readyStep(); return; }
  if (g.status === 'cancel') { requeue('상대가 들어오지 않아 다시 찾을게요'); return; }

  if (g.status === 'play' && G.shownPly === -1) {
    Sound.play('found');
    if (!G.local) setPres('play');
    show('game');
    for (const id of ['meClock', 'oppClock']) $(id).textContent = '';
    hint(g.turn === G.idx ? '내가 먼저!' : '상대가 먼저!');
    if (G.gold[1 - G.idx]) toast('상대는 오늘의 1등! 황금 ' + CHAR[1 - G.idx].name + '이에요', 2400);
    else if (G.gold[G.idx]) toast('오늘의 1등! 황금 ' + CHAR[G.idx].name + '로 나가요', 2400);
  }
  render();
  drawNetBar();
  if (g.status === 'done' && !G.ended) {
    G.ended = true;
    setTimeout(showResult, 700);
  }
}

// 둘 다 들어왔는지 확인하고, 만든 쪽이 게임을 시작시킴 (주기적으로도 다시 확인)
let readyAt = 0;
const myLook = () => ({ t: myTotal ? tierIdx(myTotal.games) : 0, a: (myTotal && myTotal.acc) || '', g: useGold() });
function readyStep() {
  const g = G.data;
  if (Date.now() - readyAt < 600) return;
  readyAt = Date.now();
  if (!(g.look && g.look[G.idx])) net.set(`games/${G.gid}/look/${G.idx}`, myLook());
  if (!(g.ready && g.ready[G.idx])) net.set(`games/${G.gid}/ready/${G.idx}`, true);
  if (G.creator && g.ready && g.ready[0] && g.ready[1]) {
    net.tx('games/' + G.gid, cur => {
      if (!cur || cur.status !== 'ready') return;
      cur.status = 'play'; cur.turnStart = nowMs();
      return cur;
    });
  }
}

// 이번 차례 남은 시간(ms). 대전은 각자 "차례가 바뀐 걸 본 순간"부터 자기 시계로 잼
function turnLeft(g) { return G.local ? g.turnStart + TURN_MS - nowMs() : G.seenAt + TURN_MS - Date.now(); }
const OPP_GRACE_OFF = 2000;    // 상대 연결이 끊겼을 때: 상대 시간이 끝나고 2초 뒤 승리
const OPP_GRACE_ON = 15000;    // 상대가 연결돼 있으면 상대 기기가 스스로 판정하길 기다림 (멈춘 기기 대비 15초 뒤)

function tick() {
  if (!G) return;
  if (!G.data) {
    // 짝은 지어졌는데 게임이 만들어지지 않음 → 다시 찾기
    if (Date.now() > G.readyBy) requeue('상대가 들어오지 않아 다시 찾을게요');
    return;
  }
  const g = G.data;
  const now = nowMs();
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
  const leftMs = turnLeft(g);
  const left = Math.max(0, leftMs);
  const mine = g.turn === G.idx;
  const sec = Math.ceil(left / 1000);
  if (mine && sec <= 3 && sec > 0 && G.lastTick !== g.ply + ':' + sec) { G.lastTick = g.ply + ':' + sec; Sound.play('tick'); }
  if (G.local && mine && now - g.turnStart > 10000 && G.said.think !== g.ply && (G.said.thinkN || 0) < 2) { G.said.think = g.ply; G.said.thinkN = (G.said.thinkN || 0) + 1; aiSay('think'); }
  $('meClock').textContent = mine ? sec : '';
  $('oppClock').textContent = mine ? '' : sec;
  $('meClock').classList.toggle('low', mine && sec <= 3);
  $('oppClock').classList.toggle('low', !mine && sec <= 3);
  if (G.local) {
    if (mine && leftMs < -300) endGame({ winner: 1 - G.idx, reason: 'timeout' }, g.ply);
    return;
  }
  if (!netOn) return;              // 내 연결이 끊긴 동안은 판정하지 않음
  // 시간 초과는 시간을 넘긴 본인 기기가 판정
  if (mine && leftMs < -300) endGame({ winner: 1 - G.idx, reason: 'timeout', by: G.idx }, g.ply);
  // 상대 차례: 상대 연결이 끊긴 게 확인될 때만 일찍 승리, 아니면 넉넉히 기다림
  if (!mine) {
    if (!G.oppOn && leftMs < -OPP_GRACE_OFF && Date.now() - G.oppOffAt > 3000) endGame({ winner: G.idx, reason: 'left', by: G.idx }, g.ply);
    else if (leftMs < -OPP_GRACE_ON) endGame({ winner: G.idx, reason: 'timeout', by: G.idx }, g.ply);
  }
}

let ending = false;
async function endGame(result, ply) {
  if (!G || ending) return;
  if (G.local) { if (G.data.status === 'play') setLocal({ ...G.data, status: 'done', result }); return; }
  ending = true;
  const expect = ply ?? G.data.ply;
  try {
    await net.tx('games/' + G.gid, cur => {
      if (!cur || cur.status !== 'play' || cur.ply !== expect) return;
      cur.status = 'done'; cur.result = { ...result, at: nowMs() };
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
  sel = null;
  if (G.local) { localMove(idx, from, to); return; }
  moving = true;
  // 누르는 즉시 화면에서 먼저 움직임 (서버 저장은 뒤에서)
  const r0 = applyMove(norm(g.pos), idx, from, to, ply);
  G.pending = r0.ply;
  G.data = { ...g, pos: r0.pos, ply: r0.ply, turn: 1 - idx, turnStart: nowMs() };
  const prevSeenAt = G.seenAt;
  G.seenPly = r0.ply; G.seenAt = Date.now();
  moving = false;
  render();
  let ok = false;
  try {
    const res = await net.tx('games/' + G.gid, cur => {
      if (!cur || cur.status !== 'play' || cur.turn !== idx || cur.ply !== ply) return;
      const pos = norm(cur.pos);
      if (!isLegal(pos, idx, from, to)) return;
      const r = applyMove(pos, idx, from, to, cur.ply);
      cur.pos = r.pos; cur.ply = r.ply; cur.turn = 1 - idx; cur.turnStart = nowMs();
      cur.last = { from, to, by: idx };
      if (r.result) { cur.status = 'done'; cur.result = { ...r.result, by: idx, at: nowMs() }; }
      return cur;
    });
    ok = res.committed;
  } catch (e) { console.warn(e); }
  if (!G) return;
  if (!ok && G.pending != null) {
    // 저장 실패: 서버 상태로 되돌림
    G.pending = null;
    if (G.server) G.data = G.server;
    G.seenPly = G.data.ply; G.seenAt = prevSeenAt;   // 되돌린 차례는 원래 시작 시각 그대로
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

// 황금 여부는 게임에 적힌 각자의 look.g 로 (나중에 도착해도 반영)
function applyGold() {
  const g = G.data, me = G.idx, op = 1 - me;
  const ng = { 0: !!(g.look && g.look[0] && g.look[0].g), 1: !!(g.look && g.look[1] && g.look[1].g) };
  const changed = !G.gold || ng[0] !== G.gold[0] || ng[1] !== G.gold[1];
  G.gold = ng;
  $('meCrown').hidden = !ng[me]; $('oppCrown').hidden = !ng[op];
  $('meInfo').textContent = (ng[me] ? '황금 ' : '') + CHAR[me].name + (ng[me] ? ' · 오늘의 1등' : '');
  if (!G.local) $('oppInfo').textContent = (ng[op] ? '황금 ' : '') + CHAR[op].name + (ng[op] ? ' · 오늘의 1등' : '');
  if (changed && G.pieceEls) for (const pl of [0, 1]) G.pieceEls[pl].forEach(P => { P.accKey = null; drawSparks(P, pl); });
  $('meImg').src = img(me, 'idle'); $('oppImg').src = img(op, 'idle');
}
function drawSparks(P, pl) {
  P.hop.querySelectorAll('.spark').forEach(e => e.remove());
  if (G.gold[pl]) for (const [sx, sy, r] of [[-26, -34, 7], [24, -12, 5]]) {
    el('path', { class: 'spark', d: `M${sx} ${sy - r}L${sx + r * .3} ${sy - r * .3}L${sx + r} ${sy}L${sx + r * .3} ${sy + r * .3}L${sx} ${sy + r}L${sx - r * .3} ${sy + r * .3}L${sx - r} ${sy}L${sx - r * .3} ${sy - r * .3}Z`, fill: '#fff6b0' }, P.hop);
  }
}
function setupGameScreen() {
  hideBubbles(); $('emoPan').hidden = true;
  const g = G.data, me = G.idx, op = 1 - me;
  G.gold = { 0: false, 1: false };
  applyGold();
  // 판 방향: 0번이면 판 전체를 돌려 내 진영을 아래로
  $('lines').setAttribute('transform', me === 0 ? 'rotate(180 180 310)' : '');
  $('meImg').src = img(me, 'idle'); $('oppImg').src = img(op, 'idle');
  $('meName').textContent = g.p[me].name + ' (나)';
  $('oppName').textContent = g.p[op].name;

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
      if (G.gold[pl]) for (const [sx, sy, r] of [[-26, -34, 7], [24, -12, 5]]) {
        el('path', { class: 'spark', d: `M${sx} ${sy - r}L${sx + r * .3} ${sy - r * .3}L${sx + r} ${sy}L${sx + r * .3} ${sy + r * .3}L${sx} ${sy + r}L${sx - r * .3} ${sy + r * .3}L${sx - r} ${sy}L${sx - r * .3} ${sy - r * .3}Z`, fill: '#fff6b0' }, hop);
      }
      gEl.addEventListener('click', () => onPieceTap(pl, k));
      G.pieceEls[pl].push({ g: gEl, hop, im, accKey: null, at: null });
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
  if (sel != null) Sound.play('select');
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
        setSprite(P, pl, 'move');
        P.hop.classList.remove('go'); void P.hop.getBBox(); P.hop.classList.add('go');
        Sound.play(CHAR[pl].key === 'pumpkin' ? 'move_pumpkin' : 'move_wisp');
        setTimeout(() => { if (G && !G.ended) setSprite(P, pl, 'idle'); }, 420);
      }
      P.at = n;
      const ak = (g.look && g.look[pl] && g.look[pl].a) || '';
      if (P.accKey !== ak) { P.accKey = ak; setSprite(P, pl, P.state || 'idle'); }
      const can = myTurn && pl === me && targets(pos, pl, n).length > 0;
      P.g.classList.toggle('can', can && sel !== n);
      P.g.classList.toggle('sel', sel === n);
      if (done) setSprite(P, pl, pl === loser ? 'stuck' : 'idle');
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
  for (const [pl, id] of [[me, 'meTier'], [1 - me, 'oppTier']]) {
    const t = g.look && g.look[pl] ? g.look[pl].t || 0 : 0;
    if ($(id).dataset.t !== String(t)) { $(id).dataset.t = t; $(id).src = tierImg(t); $(id).title = TIERS[t][1]; }
  }
  $('movesInfo').textContent = `남은 수 ${leftMine}·${leftOpp}`;
  $('movesInfo').title = `남은 수: 나 ${leftMine}수, 상대 ${leftOpp}수`;
  if (g.status === 'play' && G.shownPly !== g.ply) {
    if (G.shownPly !== -1 && g.turn === me) { hint('내 차례!', 700); setTimeout(() => Sound.play('myturn'), 250); }
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
  if (r.draw) { title = '비겼어요'; pic = 'img/icon_draw.png'; text = '30수 동안 아무도 가두지 못했어요'; Sound.play('draw'); }
  else if (r.winner === me) {
    title = '이겼어요!'; pic = 'img/icon_win.png';
    Sound.play('win');
    text = { stuck: '상대 말을 모두 가뒀어요', timeout: '상대가 시간 안에 두지 못했어요', leave: '상대가 기권했어요', left: '상대 연결이 끊겼어요' }[r.reason] || '';
  } else {
    title = '졌어요'; pic = img(me, 'stuck');
    Sound.play('lose');
    text = { stuck: '내 말이 모두 갇혔어요', timeout: '시간 안에 두지 못했어요', leave: '기권했어요', left: '연결이 끊겨서 시간 안에 두지 못했어요' }[r.reason] || '';
  }
  for (const id of ['meClock', 'oppClock']) $(id).textContent = '';
  for (const id of ['meT', 'oppT']) $(id).style.transform = 'scaleX(0)';
  $('resImg').src = pic; $('resTitle').textContent = title; $('resText').textContent = text;
  $('resScore').textContent = '';
  lastPractice = G.local ? G.level : null;
  if (G.local) {
    const boss = G.level === 'hard';
    const [ek, line] = AI_LINES[G.level][r.draw ? 'draw' : r.winner === me ? 'lose' : 'win'];
    const praise = boss && r.draw ? '도깨비 대장과 비겼어요! 정말 대단해요' : boss && r.winner === me ? '도깨비 대장을 이겼어요!!' : '연습 경기라 점수에는 들어가지 않아요';
    $('resScore').innerHTML = `<div class="up" style="color:var(--ink)"><img src="img/emo/${ek}.png" alt="">${esc(AI_LV[G.level])}: “${esc(line)}”</div><div class="meh">${praise}</div>`;
  } else reportResult(G.gid);
  $('resTitle').style.color = r.draw ? 'var(--ink)' : r.winner === me ? 'var(--gold)' : '#9fd7ff';
  modal('resultModal', true);
  closeGame();
  presState = null;
  setTimeout(() => { if (net && !matching && !G) net.offline(); }, 1500);
}

// 시간 막대는 화면 새로 그릴 때마다 부드럽게
(function frame() {
  if (G && G.data && G.data.status === 'play') {
    const g = G.data, mine = g.turn === G.idx;
    const f = Math.max(0, Math.min(1, turnLeft(g) / TURN_MS));
    $('meT').style.transform = `scaleX(${mine ? f : 0})`;
    $('oppT').style.transform = `scaleX(${mine ? 0 : f})`;
  }
  requestAnimationFrame(frame);
})();
boot();
