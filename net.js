// 통신 계층: 실제 Firebase(FirebaseNet)와 시험용(MockNet, 주소 뒤에 ?test=1)
// 공통 기능: init() → uid, online(), offline(), connected(cb), tx(path, fn), set, update, on(path, cb) → 해제 함수, now(), newId()

const FB_VER = '10.12.2';
const firebaseConfig = {
  apiKey: 'AIzaSyD8U6DydxhFsh-n7C9U-_WxS63J7Ayqol8',
  authDomain: 'hobak-gonu.firebaseapp.com',
  databaseURL: 'https://hobak-gonu-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'hobak-gonu',
  storageBucket: 'hobak-gonu.firebasestorage.app',
  messagingSenderId: '676464832902',
  appId: '1:676464832902:web:b06bc4d334e9ee4f24fc07',
};

export async function createNet() {
  const test = new URLSearchParams(location.search).has('test');
  const net = test ? new MockNet() : new FirebaseNet();
  await net.init();
  return net;
}

class FirebaseNet {
  async init() {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [{ initializeApp }, A, D] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-database.js'),
    ]);
    this.D = D;
    const app = initializeApp(firebaseConfig);
    const auth = A.getAuth(app);
    const cred = await A.signInAnonymously(auth);
    this.uid = cred.user.uid;
    this.db = D.getDatabase(app);
    this.offset = 0;
    D.onValue(D.ref(this.db, '.info/serverTimeOffset'), s => { this.offset = s.val() || 0; });
    D.goOffline(this.db); // 매칭·대전 중에만 연결 (동시 접속 100명 한도 아끼기)
    return this.uid;
  }
  online() { this.D.goOnline(this.db); }
  offline() { this.D.goOffline(this.db); }
  connected(cb) { return this.D.onValue(this.D.ref(this.db, '.info/connected'), s => cb(!!s.val())); }
  now() { return Date.now() + this.offset; }
  newId() { return this.D.push(this.D.ref(this.db, 'games')).key; }
  async tx(path, fn) {
    const r = await this.D.runTransaction(this.D.ref(this.db, path), fn, { applyLocally: false });
    return { committed: r.committed, val: r.snapshot.val() };
  }
  set(path, v) { return this.D.set(this.D.ref(this.db, path), v); }
  update(path, v) { return this.D.update(this.D.ref(this.db, path), v); }
  on(path, cb) { return this.D.onValue(this.D.ref(this.db, path), s => cb(s.val())); }
}

// 시험용: 같이 실행하는 testserver.mjs가 서버 역할 (비교 후 쓰기로 트랜잭션 흉내)
class MockNet {
  async init() {
    this.uid = 'u' + Math.random().toString(36).slice(2, 8);
    this.subs = new Set();
    this.isOnline = false;
    this.connSubs = new Set();
    new EventSource('/__events').onmessage = () => this._refresh();
    return this.uid;
  }
  async _get(path) { return (await (await fetch('/__db?p=' + encodeURIComponent(path))).json()).val; }
  async _post(path, val, expect) {
    const r = await fetch('/__db', { method: 'POST', body: JSON.stringify({ p: path, val: val ?? null, expect }) });
    return r.status !== 409;
  }
  async _refresh() {
    for (const s of this.subs) {
      const v = await this._get(s.path); const j = JSON.stringify(v);
      if (j !== s.last && this.subs.has(s)) { s.last = j; s.cb(v); }
    }
  }
  online() { this.isOnline = true; setTimeout(() => this.connSubs.forEach(c => c(true)), 50); }
  offline() { this.isOnline = false; this.connSubs.forEach(c => c(false)); }
  connected(cb) { this.connSubs.add(cb); cb(this.isOnline); return () => this.connSubs.delete(cb); }
  now() { return Date.now(); }
  newId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  async tx(path, fn) {
    for (let i = 0; i < 20; i++) {
      const cur = await this._get(path);
      const nv = fn(cur == null ? null : JSON.parse(JSON.stringify(cur)));
      if (nv === undefined) return { committed: false, val: cur };
      if (await this._post(path, nv, JSON.stringify(cur))) return { committed: true, val: nv };
    }
    throw new Error('tx 실패');
  }
  set(path, v) { return this._post(path, v); }
  async update(path, obj) { for (const [k, v] of Object.entries(obj)) await this._post(path + '/' + k, v); }
  on(path, cb) {
    const s = { path, cb, last: undefined };
    this.subs.add(s); this._refresh();
    return () => this.subs.delete(s);
  }
}
