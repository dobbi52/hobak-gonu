/* =========================================================
   호박 고누 — 오늘의 순위표 서버
   - 날마다 시트 하나(예: 2026-10-17)에 그날 점수를 모아요. 자정이 지나면 새 시트 = 자동 초기화
   - 점수: 승 3점, 무 1점, 패 0점
   - 기록하기 전에 ① 생각 오락실 통합 계정 비밀번호 ② Firebase에 실제로 끝난 경기인지 확인해요
   - 14일보다 오래된 날짜 시트는 저절로 지워요
   - 같은 상대와는 하루 5판까지만 점수·기록에 들어가요 (그 뒤로는 대전만 돼요)
   - '누적' 시트: 등급(판수)과 꾸미기(승수)용 기록. 둘이 합쳐 10수 이상 둔 판만 들어가요
   ========================================================= */
const ARCADE_API = 'https://script.google.com/macros/s/AKfycbzZlmUD9M4rfo4Y4eEYgNjZH0N8SppUA1Otuo9yMEOqcLfklw8XbS5ZmXj1D3KZY4EG/exec';
const FIREBASE_DB = 'https://hobak-gonu-default-rtdb.asia-southeast1.firebasedatabase.app';
const PTS = { W: 3, D: 1, L: 0 };
const KEEP_DAYS = 14;
const HEAD = ['닉네임', '점수', '승', '무', '패', '점수 낸 시각', '경기 번호', '상대별 판수'];
const TOTAL_HEAD = ['닉네임', '판수', '승', '무', '패', '꾸미기', '마지막 경기'];
const PAIR_LIMIT = 5;      // 같은 상대와 하루에 점수가 오르는 판수
const MIN_PLY = 10;        // 누적 기록에 들어가는 최소 수 (둘이 합쳐)
const ACC = { ribbon: 3, straw: 10, glasses: 25, wizard: 50, wreath: 100 };   // 꾸미기: 필요한 누적 승수

function doPost(e) {
  let out;
  try {
    const q = JSON.parse(e.postData.contents);
    if (q.action === 'report') out = report(q);
    else if (q.action === 'board') out = board(q);
    else if (q.action === 'equip') out = equip(q);
    else out = { ok: false, error: '알 수 없는 요청' };
  } catch (err) {
    out = { ok: false, error: '서버 오류: ' + err, retry: true };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
// 주소 뒤에 ?check=1 을 붙여 열면 연결 상태를 점검해요
function doGet(e) {
  let t = '호박 고누 순위표 서버 작동 중';
  if (e && e.parameter && e.parameter.check) {
    const fb = UrlFetchApp.fetch(FIREBASE_DB + '/games/test.json', { muteHttpExceptions: true });
    t += '\n· Firebase 경기 읽기: ' + (fb.getResponseCode() === 200 ? '정상' : '안 됨 (규칙에서 games의 .read를 true로 바꿔 주세요) ' + fb.getContentText());
    const ar = UrlFetchApp.fetch(ARCADE_API, { method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true, payload: JSON.stringify({ action: 'login', nick: '점검', pin: '0000' }) });
    let ok = false; try { JSON.parse(ar.getContentText()); ok = true; } catch (er) {}
    t += '\n· 통합 로그인 서버: ' + (ok ? '정상' : '응답 이상 ' + ar.getResponseCode());
    t += '\n· 오늘 시트: ' + (daySheet(today(), false) ? '있음' : '아직 없음 (첫 경기 기록 때 생겨요)');
  }
  return ContentService.createTextOutput(t);
}

/* ---------- 날짜 ---------- */
function dayKey(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd'); }
function today() { return dayKey(Date.now()); }
function yesterday() { return dayKey(Date.now() - 24 * 3600 * 1000); }

function daySheet(key, create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(key);
  if (!sh && create) {
    sh = ss.insertSheet(key, 0);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    cleanup(ss);
  }
  return sh;
}
function cleanup(ss) {
  const limit = dayKey(Date.now() - KEEP_DAYS * 24 * 3600 * 1000);
  ss.getSheets().forEach(sh => {
    const n = sh.getName();
    if (/^\d{4}-\d\d-\d\d$/.test(n) && n < limit && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

/* ---------- 확인 ---------- */
function checkAccount(nick, pin) {
  const cache = CacheService.getScriptCache();
  const key = 'acc:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, nick + '|' + pin));
  if (cache.get(key)) return true;
  const r = UrlFetchApp.fetch(ARCADE_API, {
    method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify({ action: 'login', nick: nick, pin: pin }),
  });
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (j.ok && j.nick === nick) { cache.put(key, '1', 1800); return true; }
  return false;
}
function readGame(gid) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(gid)) return null;
  const r = UrlFetchApp.fetch(FIREBASE_DB + '/games/' + gid + '.json', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  return JSON.parse(r.getContentText());
}

/* ---------- 누적 기록 ---------- */
function totalSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('누적');
  if (!sh) { sh = ss.insertSheet('누적'); sh.appendRow(TOTAL_HEAD); sh.setFrozenRows(1); }
  return sh;
}
function findRow(sh, nick) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const f = sh.getRange(2, 1, last - 1, 1).createTextFinder(nick).matchEntireCell(true).matchCase(true).findNext();
  return f ? f.getRow() : -1;
}
function totalOf(nick) {
  const sh = totalSheet(), row = findRow(sh, nick);
  if (row < 0) return { games: 0, w: 0, d: 0, l: 0, acc: '' };
  const r = sh.getRange(row, 1, 1, 6).getValues()[0];
  return { games: +r[1], w: +r[2], d: +r[3], l: +r[4], acc: String(r[5] || '') };
}
function totalsMap() {
  const sh = totalSheet(), last = sh.getLastRow(), m = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 6).getValues().forEach(r => { if (r[0]) m[String(r[0])] = [+r[1], String(r[5] || '')]; });
  return m;
}

/* ---------- 결과 기록 ---------- */
function report(q) {
  const nick = String(q.nick || ''), pin = String(q.pin || ''), gid = String(q.gid || '');
  if (!checkAccount(nick, pin)) return { ok: false, error: '로그인 정보가 맞지 않아요', code: 'AUTH' };
  const g = readGame(gid);
  if (!g || g.status !== 'done' || !g.result || !g.p) return { ok: false, error: '끝난 경기를 찾지 못했어요', retry: true };
  if (Date.now() - (g.t || 0) > 2 * 3600 * 1000) return { ok: false, error: '너무 오래된 경기예요' };
  const p = [g.p[0] || {}, g.p[1] || {}];
  const idx = p[0].name === nick ? 0 : p[1].name === nick ? 1 : -1;
  if (idx < 0) return { ok: false, error: '내가 한 경기가 아니에요' };
  if (!p[0].uid || !p[1].uid || p[0].uid === p[1].uid || p[0].name === p[1].name) return { ok: false, error: '올바르지 않은 경기예요' };
  const res = g.result.draw ? 'D' : g.result.winner === idx ? 'W' : 'L';
  const opp = String(p[1 - idx].name);
  const longEnough = (+g.ply || 0) >= MIN_PLY;

  let counted = false, pairN = 0, dup = false;
  const before = totalOf(nick);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const key = today();
    const sh = daySheet(key, true);
    let row = findRow(sh, nick), cur;
    if (row < 0) { cur = [nick, 0, 0, 0, 0, '', '', '{}']; row = sh.getLastRow() + 1; }
    else cur = sh.getRange(row, 1, 1, 8).getValues()[0];
    const gids = String(cur[6] || '');
    if ((',' + gids + ',').indexOf(',' + gid + ',') >= 0) dup = true;   // 같은 경기는 한 번만
    let pairs = {};
    try { pairs = JSON.parse(cur[7] || '{}'); } catch (e) {}
    if (!dup) {
      pairN = (pairs[opp] || 0) + 1;
      pairs[opp] = pairN;
      counted = pairN <= PAIR_LIMIT;
      if (counted) {
        cur[1] = Number(cur[1]) + PTS[res];
        if (res === 'W') cur[2] = Number(cur[2]) + 1;
        if (res === 'D') cur[3] = Number(cur[3]) + 1;
        if (res === 'L') cur[4] = Number(cur[4]) + 1;
        if (PTS[res] > 0) cur[5] = Date.now();
      }
      cur[6] = gids ? gids + ',' + gid : gid;
      cur[7] = JSON.stringify(pairs);
      sh.getRange(row, 1, 1, 8).setValues([cur]);
      CacheService.getScriptCache().remove('board:' + key);
      // 누적 기록 (10수 이상 둔 판만)
      if (counted && longEnough) {
        const ts = totalSheet();
        let tr = findRow(ts, nick), t;
        if (tr < 0) { t = [nick, 0, 0, 0, 0, '', '']; tr = ts.getLastRow() + 1; }
        else t = ts.getRange(tr, 1, 1, 7).getValues()[0];
        t[1] = Number(t[1]) + 1;
        if (res === 'W') t[2] = Number(t[2]) + 1;
        if (res === 'D') t[3] = Number(t[3]) + 1;
        if (res === 'L') t[4] = Number(t[4]) + 1;
        t[6] = new Date();
        ts.getRange(tr, 1, 1, 7).setValues([t]);
        CacheService.getScriptCache().remove('totals');
      }
    }
  } finally { lock.releaseLock(); }
  const b = board({ nick: nick });
  return { ok: true, result: res, counted: counted, dup: dup, pairN: pairN, pairLimit: PAIR_LIMIT, longEnough: longEnough,
    me: b.me, before: before, total: totalOf(nick) };
}

/* ---------- 꾸미기 ---------- */
function equip(q) {
  const nick = String(q.nick || ''), pin = String(q.pin || ''), acc = String(q.acc || '');
  if (!checkAccount(nick, pin)) return { ok: false, error: '로그인 정보가 맞지 않아요', code: 'AUTH' };
  if (acc && !(acc in ACC)) return { ok: false, error: '없는 꾸미기예요' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ts = totalSheet();
    let tr = findRow(ts, nick), t;
    if (tr < 0) { t = [nick, 0, 0, 0, 0, '', '']; tr = ts.getLastRow() + 1; }
    else t = ts.getRange(tr, 1, 1, 7).getValues()[0];
    if (acc && Number(t[2]) < ACC[acc]) return { ok: false, error: ACC[acc] + '승부터 쓸 수 있어요' };
    t[5] = acc;
    ts.getRange(tr, 1, 1, 7).setValues([t]);
    CacheService.getScriptCache().remove('totals');
  } finally { lock.releaseLock(); }
  return { ok: true, total: totalOf(nick) };
}

/* ---------- 순위표 ---------- */
function ranking(key) {
  const sh = daySheet(key, false);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues()
    .filter(r => r[0])
    .map(r => ({ nick: String(r[0]), pts: +r[1], w: +r[2], d: +r[3], l: +r[4], at: +r[5] || 9e15 }));
  // 점수 → 승리 수 → 먼저 그 점수에 도달한 순
  rows.sort((a, b) => b.pts - a.pts || b.w - a.w || a.at - b.at);
  rows.forEach((r, i) => { r.rank = i + 1; delete r.at; });
  return rows;
}
function board(q) {
  const cache = CacheService.getScriptCache();
  const key = today();
  let data = cache.get('board:' + key);
  if (data) data = JSON.parse(data);
  else {
    const all = ranking(key);
    let champ = cache.get('champ:' + yesterday());
    if (champ === null) {
      const y = ranking(yesterday());
      champ = y.length && y[0].pts > 0 ? y[0].nick : '';
      cache.put('champ:' + yesterday(), champ, 21600);
    }
    const tm = totalsMap();
    const top = all.slice(0, 10).map(r => Object.assign(r, { games: (tm[r.nick] || [0])[0] }));
    data = { day: key, champ: champ, total: all.length, top: top, all: all.slice(0, 1000).map(r => [r.nick, r.pts, r.w, r.d, r.l]) };
    cache.put('board:' + key, JSON.stringify(data), 20);
  }
  let me = null, total = null;
  if (q && q.nick) {
    const i = data.all.findIndex(r => r[0] === q.nick);
    if (i >= 0) { const r = data.all[i]; me = { nick: r[0], pts: r[1], w: r[2], d: r[3], l: r[4], rank: i + 1 }; }
    total = totalOf(q.nick);
  }
  return { ok: true, day: data.day, champ: data.champ, total: data.total, top: data.top, me: me, mine: total };
}
