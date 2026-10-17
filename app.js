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
// 어제의 1등은 황금 캐릭터 (gold: 그 쪽이 1등인지)
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
let champ = '';      // 어제의 1등 닉네임
let myTotal = null;  // 내 누적 기록 {games, w, d, l, acc}

// 등급 (누적 판수)과 꾸미기 (누적 승수)
const TIERS = [[0, '씨앗', 'seed'], [5, '새싹', 'sprout'], [15, '떡잎', 'leaf'], [40, '덩굴', 'vine'], [80, '호박꽃', 'flower'], [150, '큰 호박', 'pumpkin'], [300, '전설의 호박', 'legend']];
const tierIdx = games => { let i = 0; TIERS.forEach((t, k) => { if ((games || 0) >= t[0]) i = k; }); return i; };
const tierImg = i => `img/tier_${TIERS[i][2]}.png`;
const ACCS = [['ribbon', '리본', 3, 44, 31.5], ['straw', '밀짚모자', 10, 55, 31.5], ['glasses', '선글라스', 25, 57, 20.5], ['wizard', '마법사 모자', 50, 51, 44], ['wreath', '꽃 화관', 100, 54, 28]];
const accOf = k => ACCS.find(a => a[0] === k);
const eul = w => w + ((w.charCodeAt(w.length - 1) - 0xAC00) % 28 ? '을' : '를');   // 받침에 따라 을/를
let lastBoard = null;
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
  const meChamp = a && champ && a.nick === champ;
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
  $('leaveBtn').onclick = () => { if (G && G.data?.status === 'play') endGame({ winner: 1 - G.idx, reason: 'leave' }); };
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
    $('startBtn').disabled = false;
    loadLive();
  } catch (e) {
    console.error(e);
    $('homeErr').textContent = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
  }
}

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
    '<li><span class="tk">10초</span><span>한 수에 <b>10초</b>! 시간이 지나면 져요.</span></li>' +
    '<li><span class="tk">30</span><span>한 사람당 <b>30수</b>가 지나도 안 끝나면 비겨요.</span></li>' +
    '<li><span class="tk pic"><img src="img/icon_win.png" alt=""></span><span>이기면 <b>3점</b>, 비기면 <b>1점</b>. 오늘의 순위는 밤 12시에 새로 시작해요.</span></li>' +
    '<li><span class="tk pic"><img src="img/gpumpkin_idle.png" alt=""></span><span><b>어제의 1등</b>은 오늘 하루 황금 캐릭터로 나와요!</span></li>' +
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
function openDeco() {
  if (!auth()) { window.ArcadeAuth && window.ArcadeAuth.open(AUTH_OPTS); return; }
  if (!myTotal) { toast('기록을 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요'); loadBoard(); return; }
  drawDeco();
  modal('decoModal', true);
}
function drawDeco() {
  const t = myTotal, ti = tierIdx(t.games), next = TIERS[ti + 1];
  const pct = next ? Math.round((t.games - TIERS[ti][0]) / (next[0] - TIERS[ti][0]) * 100) : 100;
  $('decoTier').innerHTML = `<img src="${tierImg(ti)}" alt=""><div style="flex:1"><div class="tn">${TIERS[ti][1]}</div>
    <div class="ts">누적 ${t.games}판 · ${t.w}승 ${t.d}무 ${t.l}패<br>${next ? `${next[1]}까지 ${next[0] - t.games}판 남았어요` : '가장 높은 등급이에요!'}</div>
    <div class="pb"><i style="width:${pct}%"></i></div></div>`;
  const gold = auth() && champ && auth().nick === champ;
  const pv = (k) => ['pumpkin', 'wisp'].map((c, i) => {
    const S = 36 / 64, ox = i * 36 + 18, oy = 18 + 42 * S;   // 말 그림 좌표 (0,0)이 오는 자리
    const w = !gold && wornOf(c, k, 'idle');
    const [src, b] = w ? [w.href, w.box] : [`img/${gold ? 'g' : ''}${c}_idle.png`, [-32, -42, 64, 64]];
    return `<img src="${src}" style="left:${ox + b[0] * S}px;top:${oy + b[1] * S}px;width:${b[2] * S}px;height:${b[3] * S}px;${w ? '' : 'object-fit:contain'}" alt="">`;
  }).join('');
  const items = [['', '안 쓰기', 0]].concat(ACCS.map(a => [a[0], a[1], a[2]]));

  $('decoGold').hidden = !gold;
  $('decoGrid').innerHTML = items.map(([k, name, need]) => {
    const lock = t.w < need, on = (t.acc || '') === k;
    return `<button class="deco-item${on ? ' on' : ''}${lock ? ' lock' : ''}" data-k="${k}" ${lock ? 'disabled' : ''}><span class="pv">${pv(k)}</span><span class="nm">${name}</span><span class="rq">${on ? '쓰는 중' : lock ? `${need}승부터` : need ? `${need}승 달성` : ''}</span></button>`;
  }).join('');
  $('decoGrid').querySelectorAll('.deco-item:not(.lock)').forEach(b => b.onclick = () => equip(b.dataset.k));
}
async function equip(k) {
  const a = auth(); if (!a || (myTotal.acc || '') === k) return;
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
  if (!j.ok) { if (!lastBoard) $('rankList').innerHTML = `<div class="empty">${esc(j.error)}</div>`; return; }
  lastBoard = j;
  champ = j.champ || '';
  if (a && j.mine) myTotal = j.mine;
  if (!a) myTotal = null;
  drawBoard(j);
  drawAccount();
}

function drawBoard(j) {
  const a = auth();
  $('rankDay').textContent = j.day ? j.day.slice(5).replace('-', '월 ') + '일 · 승 3점 무 1점' : '';
  $('champLine').innerHTML = j.champ
    ? `<div class="champ"><img src="img/gpumpkin_idle.png" alt=""><span>어제의 1등 <b>${esc(j.champ)}</b><br>오늘 하루 황금 캐릭터로 나와요!</span></div>` : '';
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
  net.setPresence('wait').catch(() => {});
  if (presUnsub) presUnsub();
  presUnsub = net.on('presence', v => {          // 지금 대전 중인 친구 수 (나는 빼고)
    const others = { ...(v || {}) }; delete others[uid];
    waitPlayers = countPresence(others);
    drawWaitInfo();
  });
  await net.set('pair/' + uid, null);
  pairUnsub = net.on('pair/' + uid, gid => { if (gid) onPaired(gid); });
  await lobbyTick();
  hb = setInterval(lobbyTick, 4000);
}

let presUnsub = null, waitPlayers = null;
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
}

// 대기 자리가 비었으면 내가 앉고, 다른 친구가 기다리고 있으면 짝이 됨
async function lobbyTick() {
  if (!matching) return;
  let taken = null;
  try {
    await net.tx('lobby', cur => {
      taken = null;
      const now = nowMs();
      if (cur && cur.uid !== uid && cur.name !== myName && now - cur.t < 15000) { taken = cur; return null; }
      return { uid, name: myName, t: now };
    });
  } catch (e) { console.warn(e); return; }
  if (!matching) return;
  if (taken) {
    stopMatchingListeners();
    await createGame(taken);
  } else if (Date.now() - waitStart > 20000) {
    drawWaitInfo();
    $('waitAiBtn').hidden = false;
  }
}

async function leaveLobby() {
  try { await net.tx('lobby', cur => (cur && cur.uid === uid ? null : cur)); } catch {}
}

async function cancelMatching() {
  stopMatchingListeners();
  await leaveLobby();
  net.offline();
  goHome();
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
  const game = { p, look: { [meIdx]: myLook() }, pos: startPos(), turn: Math.random() < 0.5 ? 0 : 1, ply: 0, status: 'ready', ready: { [meIdx]: true }, t: nowMs() };
  await net.set('games/' + gid, game);
  await net.set('pair/' + opp.uid, gid);
  joinGame(gid, true);
}

// ---------- 컴퓨터와 연습 (서버 없이 이 기기 안에서만) ----------
const AI_LV = { easy: '아기 도깨비', normal: '도깨비', hard: '도깨비 대장' };
const AI_LV_NAME = { easy: '쉬움', normal: '보통', hard: '어려움' };
let lastPractice = null;
function startPractice(level) {
  closeGame();
  const me = Math.random() < 0.5 ? 0 : 1, a = auth();
  const p = { [me]: { uid: 'me', name: a ? a.nick : '나' }, [1 - me]: { uid: 'ai', name: AI_LV[level] } };
  const look = { [me]: { t: myTotal ? tierIdx(myTotal.games) : 0, a: (myTotal && myTotal.acc) || '' }, [1 - me]: { t: 0, a: level === 'hard' ? 'wizard' : '' } };
  G = { gid: null, local: true, level, meIdx: me, idx: me, data: null, shownPly: -1, ended: false, pieceEls: null };
  clearInterval(loop);
  loop = setInterval(tick, 150);
  setLocal({ p, look, pos: startPos(), turn: Math.random() < 0.5 ? 0 : 1, ply: 0, status: 'play', turnStart: nowMs() + 800, t: nowMs() });
  $('oppInfo').textContent = '컴퓨터 · ' + AI_LV_NAME[level];
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
  G.idx = G.local ? G.meIdx : g.p[0].uid === uid ? 0 : 1;
  if (first) setupGameScreen();

  if (g.status === 'ready') { readyStep(); return; }
  if (g.status === 'cancel') { requeue('상대가 들어오지 않아 다시 찾을게요'); return; }

  if (g.status === 'play' && G.shownPly === -1) {
    Sound.play('found');
    if (!G.local) net.setPresence('play').catch(() => {});
    show('game');
    for (const id of ['meClock', 'oppClock']) $(id).textContent = '';
    hint(g.turn === G.idx ? '내가 먼저!' : '상대가 먼저!');
    if (G.gold[1 - G.idx]) toast('상대는 어제의 1등! 황금 ' + CHAR[1 - G.idx].name + '이에요', 2400);
    else if (G.gold[G.idx]) toast('어제의 1등! 오늘은 황금 ' + CHAR[G.idx].name + '로 나가요', 2400);
  }
  render();
  if (g.status === 'done' && !G.ended) {
    G.ended = true;
    setTimeout(showResult, 700);
  }
}

// 둘 다 들어왔는지 확인하고, 만든 쪽이 게임을 시작시킴 (주기적으로도 다시 확인)
let readyAt = 0;
const myLook = () => ({ t: myTotal ? tierIdx(myTotal.games) : 0, a: (myTotal && myTotal.acc) || '' });
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

function tick() {
  if (!G || !G.data) return;
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
  const left = Math.max(0, g.turnStart + TURN_MS - now);
  const mine = g.turn === G.idx;
  const sec = Math.ceil(left / 1000);
  if (mine && sec <= 3 && sec > 0 && G.lastTick !== g.ply + ':' + sec) { G.lastTick = g.ply + ':' + sec; Sound.play('tick'); }
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
  if (G.local) { if (G.data.status === 'play') setLocal({ ...G.data, status: 'done', result }); return; }
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
  sel = null;
  if (G.local) { localMove(idx, from, to); return; }
  moving = true;
  // 누르는 즉시 화면에서 먼저 움직임 (서버 저장은 뒤에서)
  const r0 = applyMove(norm(g.pos), idx, from, to, ply);
  G.pending = r0.ply;
  G.data = { ...g, pos: r0.pos, ply: r0.ply, turn: 1 - idx, turnStart: nowMs() };
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
  G.gold = { 0: !!champ && g.p[0].name === champ, 1: !!champ && g.p[1].name === champ };
  $('meCrown').hidden = !G.gold[me]; $('oppCrown').hidden = !G.gold[op];
  // 판 방향: 0번이면 판 전체를 돌려 내 진영을 아래로
  $('lines').setAttribute('transform', me === 0 ? 'rotate(180 180 310)' : '');
  $('meImg').src = img(me, 'idle'); $('oppImg').src = img(op, 'idle');
  $('meName').textContent = g.p[me].name + ' (나)';
  $('oppName').textContent = g.p[op].name;
  $('meInfo').textContent = (G.gold[me] ? '황금 ' : '') + CHAR[me].name + (G.gold[me] ? ' · 어제의 1등' : '');
  $('oppInfo').textContent = (G.gold[op] ? '황금 ' : '') + CHAR[op].name + (G.gold[op] ? ' · 어제의 1등' : '');
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
  $('movesInfo').textContent = `남은 수  나 ${leftMine} · 상대 ${leftOpp}`;
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
    text = { stuck: '상대 말을 모두 가뒀어요', timeout: '상대가 시간 안에 두지 못했어요', leave: '상대가 기권했어요' }[r.reason] || '';
  } else {
    title = '졌어요'; pic = img(me, 'stuck');
    Sound.play('lose');
    text = { stuck: '내 말이 모두 갇혔어요', timeout: '시간 안에 두지 못했어요', leave: '기권했어요' }[r.reason] || '';
  }
  for (const id of ['meClock', 'oppClock']) $(id).textContent = '';
  for (const id of ['meT', 'oppT']) $(id).style.transform = 'scaleX(0)';
  $('resImg').src = pic; $('resTitle').textContent = title; $('resText').textContent = text;
  $('resScore').textContent = '';
  lastPractice = G.local ? G.level : null;
  if (G.local) {
    const boss = G.level === 'hard';
    $('resScore').textContent = boss && r.draw ? '도깨비 대장과 비겼어요! 정말 대단해요' : boss && r.winner === me ? '도깨비 대장을 이겼어요!!' : '연습 경기라 점수에는 들어가지 않아요';
  } else reportResult(G.gid);
  $('resTitle').style.color = r.draw ? 'var(--ink)' : r.winner === me ? 'var(--gold)' : '#9fd7ff';
  modal('resultModal', true);
  closeGame();
  setTimeout(() => { if (net && !matching && !G) net.offline(); }, 1500);
}

// 시간 막대는 화면 새로 그릴 때마다 부드럽게
(function frame() {
  if (G && G.data && G.data.status === 'play') {
    const g = G.data, mine = g.turn === G.idx;
    const f = Math.max(0, Math.min(1, (g.turnStart + TURN_MS - nowMs()) / TURN_MS));
    $('meT').style.transform = `scaleX(${mine ? f : 0})`;
    $('oppT').style.transform = `scaleX(${mine ? 0 : f})`;
  }
  requestAnimationFrame(frame);
})();
boot();
