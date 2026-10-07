/* TikTok Live "Flag Race" overlay server
 * Usage:  npm install  &&  npm start            (or: node server.js yourtiktokname)
 * Open:   http://localhost:3000/        -> overlay (OBS / TikTok Live Studio browser source)
 *         http://localhost:3000/?test   -> overlay with the test panel
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const HTML = process.env.OVERLAY_FILE || path.join(__dirname, 'overlay-71.html');
const USER_FILE = path.join(__dirname, 'lastuser.txt');
let savedUser = ''; try { savedUser = fs.readFileSync(USER_FILE, 'utf8'); } catch (e) {}
const START_USER = (process.argv[2] || process.env.TIKTOK_USER || savedUser || '').replace(/^@+/, '').trim();

/* ================= countries ================= */
const CODES = `AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW`.split(' ');
// lower-case, no accents, only letters / digits / spaces
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const byName = new Map(), enName = {}, singles = [];
(function () {
  const langs = ['en', 'ru', 'hy', 'tr', 'az', 'ka', 'uk', 'ar', 'fa', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ro', 'cs', 'sv', 'el', 'he', 'sr', 'bg', 'kk', 'uz', 'id', 'vi'];
  const dn = langs.map(l => { try { return new Intl.DisplayNames([l], { type: 'region' }); } catch (e) { return null; } });
  langs.forEach((l, li) => {
    if (!dn[li]) return;
    for (const c of CODES) {
      let n; try { n = dn[li].of(c); } catch (e) {}
      if (!n || n === c) continue;
      if (li === 0) enName[c] = n;
      const k = norm(n);
      if (!k || (li > 2 && k.length < 4)) continue;           // extra languages: only reasonably long names (avoids accidental matches)
      if (!byName.has(k)) byName.set(k, c);                    // en, ru, hy have priority; later languages never overwrite
    }
  });
  for (const c of CODES) if (!enName[c]) enName[c] = c;
  const A = { 'hong kong': 'HK', hongkong: 'HK', usa: 'US', america: 'US', 'u s a': 'US', 'u s': 'US', uk: 'GB', 'u k': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', britain: 'GB', 'great britain': 'GB', uae: 'AE', emirates: 'AE', holland: 'NL', turkiye: 'TR', turkey: 'TR', korea: 'KR', 'south korea': 'KR', 'north korea': 'KP', czechia: 'CZ', russia: 'RU', rossiya: 'RU', rossia: 'RU', rf: 'RU', ukraina: 'UA', armeniya: 'AM', hayastan: 'AM', azerbaycan: 'AZ', gruziya: 'GE', gruzia: 'GE', sakartvelo: 'GE', belorussia: 'BY', belorussiya: 'BY', kazahstan: 'KZ', uzbekistan: 'UZ', 'сша': 'US', 'россия': 'RU', 'рф': 'RU', 'армения': 'AM', 'հայաստան': 'AM', 'ամն': 'US', 'ռուսաստան': 'RU', 'ռուսիա': 'RU', 'թուրքիա': 'TR', 'ադրբեջան': 'AZ', 'վրաստան': 'GE', 'ֆրանսիա': 'FR', 'գերմանիա': 'DE', 'իտալիա': 'IT', 'իսպանիա': 'ES', 'ուկրաինա': 'UA', 'իրան': 'IR', 'չինաստան': 'CN', 'հունաստան': 'GR', 'լիբանան': 'LB', 'սիրիա': 'SY', 'եգիպտոս': 'EG', 'ամերիկա': 'US', 'անգլիա': 'GB' };
  for (const k in A) byName.set(norm(k), A[k]);
  // short forms people type in chat (exact word match). Add your own: 'short': 'COUNTRY CODE'
  const S = { arm:'AM', arme:'AM', hay:'AM', 'հայ':'AM', 'арм':'AM', 'арме':'AM', 'армен':'AM',
    rus:'RU', 'ռուս':'RU', 'рус':'RU', 'руссия':'RU', usa:'US', 'америка':'US', 'штаты':'US', 'ամերիկա':'US',
    tur:'TR', 'թուրք':'TR', 'турц':'TR', geo:'GE', 'վրաց':'GE', 'груз':'GE', 'грузия':'GE', aze:'AZ', azer:'AZ', 'азер':'AZ', 'ազեր':'AZ',
    ukr:'UA', 'укр':'UA', 'ուկր':'UA', ger:'DE', germ:'DE', deu:'DE', 'герм':'DE', 'գերմ':'DE', fra:'FR', 'франц':'FR', 'ֆրանս':'FR',
    ita:'IT', 'итал':'IT', 'իտալ':'IT', esp:'ES', 'испан':'ES', 'իսպան':'ES', chn:'CN', 'кит':'CN', 'չին':'CN',
    kaz:'KZ', 'каз':'KZ', uzb:'UZ', 'узб':'UZ', bra:'BR', 'браз':'BR', blr:'BY', irn:'IR', 'иран':'IR', 'իրան':'IR',
    'ливан':'LB', 'լիբ':'LB', 'егип':'EG', 'եգիպ':'EG', 'сирия':'SY', 'սիր':'SY', 'греция':'GR', 'հուն':'GR' };
  for (const k in S) byName.set(norm(k), S[k]);
  for (const [k, c] of byName) if (!k.includes(' ') && k.length >= 5) singles.push([k, c]);
})();
function lev1(a, b) {                       // true if a and b differ by at most one letter (typo)
  if (a === b) return true; const d = a.length - b.length; if (d > 1 || d < -1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
function fuzzy(tok) {                       // endings ("Армению", "Հայաստանը") and small typos ("Armeniya")
  if (tok.length < 5) return null;
  let best = null, bs = 0, tie = false;
  for (const [k, c] of singles) {
    const dl = Math.abs(k.length - tok.length); if (dl > 3) continue;
    let cp = 0; while (cp < k.length && cp < tok.length && k[cp] === tok[cp]) cp++;
    let sc = 0;
    if (cp >= 5 && cp >= Math.min(k.length, tok.length) - 1) sc = cp * 2 - dl;            // same beginning
    else if (tok.length >= 6 && lev1(tok, k)) sc = tok.length * 2 - 2;                    // one typo
    if (!sc) continue;
    if (sc > bs) { bs = sc; best = c; tie = false; } else if (sc === bs && c !== best) tie = true;
  }
  return tie ? null : best;
}
function findCountry(text) {
  text = String(text || '').replace(/[\uFE0E\uFE0F\u200B-\u200D\u2060\u00AD]/g, '');   // invisible chars (variation selectors, zero-width) are ignored
  // 1) flag emoji (any of them in the message)
  for (const f of text.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)) {
    const c = [...f[0]].map(ch => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65)).join('');
    if (enName[c]) return c;
  }
  if (/\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}/u.test(text)) return 'GB';     // England / Scotland / Wales flags
  // 2) country name (1-5 words, in many languages)
  const w = norm(text).split(' ').filter(Boolean);
  for (let n = 5; n >= 1; n--) for (let i = 0; i + n <= w.length; i++) { const c = byName.get(w.slice(i, i + n).join(' ')); if (c) return c; }
  // 3) short messages only: word endings and typos
  if (w.length <= 4) for (const t of w) { const c = fuzzy(t); if (c) return c; }
  return null;
}

/* ================= websocket hub ================= */
let wss;
function broadcast(m) {
  if (!wss) return;
  const s = JSON.stringify(m);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
const handle = broadcast;   // the engine below sends exactly the messages the overlay's handle() expects

/* ================= game engine (port of Eng from the HTML) ================= */
const Eng = {
  dur: Math.max(5, +process.env.DURATION || 60), race: null, users: new Map(), resetT: null,
  start() { this.newRace(); setInterval(() => this.tick(), 100); },
  newRace() { this.race = { status: 'racing', startedAt: Date.now() + 3000, progress: 0, code: null, country: null, price: 0, owner: null, avatar: null, gb: {}, pts: {} }; },
  tot(c) { const r = this.race; return (r.gb[c] || 0) + (r.pts[c] || 0); },
  user(id, name, avatar) {
    if (!this.users.has(id)) this.users.set(id, { code: null, codeAt: 0, gift: 0, giftAt: 0, gn: '', name: name || id, avatar: avatar || null, likes: 0 });
    const u = this.users.get(id); if (name) u.name = name; if (avatar) u.avatar = avatar; return u;
  },
  chat(id, text, name, avatar) {
    const c = findCountry(text);
    const raw = String(text), cps = [...raw].filter(ch => ch.codePointAt(0) > 0x2000).slice(0, 8).map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase()).join(' ');
    console.log('[chat]', name || id, ':', raw.slice(0, 60), c ? '-> ' + c : '-> (no country)' + (cps ? '   emoji codes: ' + cps : ''));
    if (!c) return;
    const u = this.user(id, name, avatar); u.code = c; u.codeAt = Date.now(); this.apply(u);
  },
  gift(id, v, gn, name, avatar) {
    if (v <= 0) return;
    const u = this.user(id, name, avatar); u.gift = v; u.gn = gn || ''; u.giftAt = Date.now();
    if (!u.code || Date.now() - u.codeAt > 300000) handle({ type: 'hint', user: u.name, text: 'write a country name in chat to place your flag' });
    this.apply(u);
  },
  apply(u) {
    const n = Date.now(); if (!u.code || n - u.codeAt > 300000 || !u.gift || n - u.giftAt > 60000) return;
    const v = u.gift, gn = u.gn; u.gift = 0; u.gn = ''; const r = this.race; if (r.status !== 'racing') return;
    r.gb[u.code] = (r.gb[u.code] || 0) + v; const t = this.tot(u.code);   // gifts for the same country ADD UP during the round
    if (t > r.price) {
      Object.assign(r, { code: u.code, country: enName[u.code], price: t, owner: u.name, avatar: u.avatar });
      handle({ type: 'flag', code: u.code, country: r.country, user: u.name, price: t, avatar: u.avatar || null });
    } else handle({ type: 'rejected', user: u.name, need: r.price + 1 - t, v });
    handle({ type: 'gift', user: u.name, code: u.code, v, giftName: gn });   // gift effects + win tiers
  },
  like(id, n, name, avatar) {                         // every 100 likes = +5 points for the country the viewer wrote
    const u = this.user(id, name, avatar), r = this.race; u.likes += n;
    if (!u.code || Date.now() - u.codeAt > 300000 || r.status !== 'racing') return;
    const k = Math.floor(u.likes / 100); if (!k) return; u.likes -= k * 100;
    const c = u.code, add = 5 * k; r.pts[c] = (r.pts[c] || 0) + add; const t = this.tot(c);
    handle({ type: 'points', code: c, country: enName[c], user: u.name, add });
    if (c === r.code) r.price = t;
    else if (t > r.price) {
      Object.assign(r, { code: c, country: enName[c], price: t, owner: u.name, avatar: u.avatar });
      handle({ type: 'flag', code: c, country: r.country, user: u.name, price: t, avatar: u.avatar || null });
    }
  },
  snapshot() {
    const r = this.race;
    return { type: 'state', cd: Math.max(0, (r.startedAt - Date.now()) / 1000), status: r.status, progress: r.progress, dur: this.dur, code: r.code, country: r.country, price: r.price, owner: r.owner, avatar: r.avatar || undefined,
      tot: Object.fromEntries([...new Set([...Object.keys(r.gb), ...Object.keys(r.pts)])].map(c => [c, this.tot(c)])) };
  },
  tick() {
    const r = this.race;
    if (r.status === 'racing') {
      const t = (Date.now() - r.startedAt) / 1000, R = 2, te = t <= 0 ? 0 : t < R ? t * t / (2 * R) : t - R / 2;   // 3 s countdown, then accelerate from 0
      r.progress = Math.min(1, te / Math.max(1, this.dur - R / 2));
      if (r.progress >= 1) {
        r.status = 'finished';
        handle({ type: 'finish', code: r.code, country: r.country, user: r.owner, price: r.price });
        this.resetT = setTimeout(() => { this.resetT = null; this.newRace(); handle({ type: 'reset' }); }, 8000);
      }
    }
    handle(this.snapshot());
  },
  restart(clearUsers) {
    if (this.resetT) { clearTimeout(this.resetT); this.resetT = null; }
    if (clearUsers) this.users.clear();
    this.newRace(); handle({ type: 'reset' });
  }
};

/* ================= TikTok Live ================= */
let TL = null;
try { TL = require('tiktok-live-connector'); } catch (e) { console.warn('[tiktok] tiktok-live-connector is not installed: run "npm install". Only the test panel will work.'); }

let conn = null, curUser = '', retryT = null, connSeq = 0;
const first = (...a) => a.find(x => x !== undefined && x !== null && x !== '');
function who(d) {
  const u = d.user || {};
  const id = String(first(u.uniqueId, d.uniqueId, u.userId, d.userId, u.nickname, d.nickname, 'viewer'));
  const name = String(first(u.nickname, d.nickname, id));
  let av = first(u.profilePictureUrl, d.profilePictureUrl, u.avatarThumb && u.avatarThumb.urlList && u.avatarThumb.urlList[0]);
  const pp = u.profilePicture; if (!av && pp) av = Array.isArray(pp.url) ? pp.url[0] : (Array.isArray(pp.urls) ? pp.urls[0] : (typeof pp === 'string' ? pp : undefined));
  return { id, name, avatar: av || null };
}
/* ---- gift prices ----
 * TikTok's newer events often carry only the gift id, so prices come from (in this order):
 * the event itself -> the library's gift list -> a catalogue downloaded from TikTok -> gifts.json -> built-in table -> DEFAULT_GIFT_COINS.
 * Unknown gifts are written into gifts.json automatically (coins = 1): open that file and put the real price. */
const GIFTS_FILE = path.join(__dirname, 'gifts.json');
const DEFAULT_GIFT_COINS = Math.max(0, +process.env.DEFAULT_GIFT_COINS || 1);
const giftTable = new Map([['5655', { name: 'Rose', coins: 1 }]]);
const catalog = new Map();
try { const j = JSON.parse(fs.readFileSync(GIFTS_FILE, 'utf8')); for (const k in j) giftTable.set(String(k), { name: j[k].name || '', coins: +j[k].coins || 0 }); console.log('[gifts] gifts.json loaded:', Object.keys(j).length, 'gifts'); } catch (e) {}
function learnGift(id, name) {
  id = String(id); if (giftTable.has(id)) return;
  giftTable.set(id, { name: name || '', coins: DEFAULT_GIFT_COINS });
  try { const o = {}; for (const [k, v] of giftTable) o[k] = v; fs.writeFileSync(GIFTS_FILE, JSON.stringify(o, null, 2)); } catch (e) {}
}
async function loadCatalog(roomId) {
  const urls = [
    'https://webcast.tiktok.com/webcast/gift/list/?aid=1988&app_language=en-US&app_name=tiktok_web&device_platform=web_pc&room_id=' + (roomId || ''),
    'https://webcast.us.tiktok.com/webcast/gift/list/?aid=1988&app_language=en-US&app_name=tiktok_web&device_platform=web_pc'
  ];
  for (const u of urls) {
    try {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(u, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' } });
      clearTimeout(t); const j = await r.json(); const arr = (j && j.data && (j.data.gifts || j.data.gift_list)) || [];
      for (const g of arr) if (g && g.id != null) catalog.set(String(g.id), { name: g.name || '', coins: +g.diamond_count || 0, type: g.type });
      if (catalog.size) { console.log('[gifts] price list downloaded:', catalog.size, 'gifts'); return; }
    } catch (e) {}
  }
  console.log('[gifts] could not download the price list - using gifts.json / built-in prices');
}
const streaks = new Map();   // streak gifts: count only the new part of each streak
function giftCoins(d) {
  const gd = d.giftDetails || {}, ex = d.extendedGiftInfo || {}, g1 = (d.gift && typeof d.gift === 'object') ? d.gift : {};
  const id = String(first(d.giftId, gd.id, g1.id, g1.giftId, ''));
  const lib = conn && Array.isArray(conn.availableGifts) ? (conn.availableGifts.find(g => String(g.id) === id) || {}) : {};
  const cat = catalog.get(id) || {}, tab = giftTable.get(id) || {};
  let per = +first(gd.diamondCount, ex.diamond_count, ex.diamondCount, g1.diamond_count, d.diamondCount, lib.diamond_count, lib.diamondCount, cat.coins, tab.coins) || 0;
  const name = String(first(gd.giftName, ex.name, d.giftName, g1.name, lib.name, cat.name, tab.name, '') || '');
  const type = first(gd.giftType, ex.type, ex.giftType, d.giftType, g1.gift_type, lib.type, cat.type);
  let known = per > 0;
  if (!known) { per = DEFAULT_GIFT_COINS; if (id) learnGift(id, name); }
  const rep = Math.max(1, +d.repeatCount || 1);
  const key = who(d).id + ':' + String(first(d.groupId, id, ''));
  let n = rep;
  if (type === undefined || type === 1) {   // streak (or unknown type): add only what is new since the last event of this streak
    const now = Date.now(), p = streaks.get(key), prev = p && now - p.t < 15000 ? p.n : 0; n = rep - prev;
    if (d.repeatEnd) streaks.delete(key); else streaks.set(key, { n: rep, t: now });
  }
  const coins = n > 0 ? per * n : 0;
  console.log('[gift]', who(d).id, name || id, 'x' + rep, 'coins=' + coins + (known ? '' : '  (!) price unknown, counted as ' + per + ' - set the real price in gifts.json (id ' + id + ')'));
  return { coins, name };
}
function status(s, extra) { broadcast(Object.assign({ type: 'hint', user: 'TikTok', text: s }, extra)); console.log('[tiktok]', s); }

function disconnect() {
  connSeq++; if (retryT) { clearTimeout(retryT); retryT = null; }
  if (conn) { try { conn.removeAllListeners(); conn.disconnect(); } catch (e) {} conn = null; }
}
function connectTikTok(username) {
  username = String(username || '').replace(/^@+/, '').trim();
  if (!username) return;
  if (!TL) { status('library tiktok-live-connector is not installed'); return; }
  if (conn && username.toLowerCase() === curUser.toLowerCase()) return;   // already connected / connecting to this user
  disconnect(); curUser = username;
  try { fs.writeFileSync(USER_FILE, username); } catch (e) {}   // remembered for the next start
  const seq = connSeq, Conn = TL.TikTokLiveConnection || TL.WebcastPushConnection;
  const EV = TL.WebcastEvent || {}, CE = TL.ControlEvent || {};
  let c;
  try { c = conn = new Conn(username, { processInitialData: false }); }   // newer library versions need an options object; old chat/gifts are skipped
  catch (e) { conn = null; curUser = ''; status('cannot start: ' + (e && e.message || e)); return; }
  const on = (name, fn) => c.on(name, d => { if (seq === connSeq) { try { fn(d || {}); } catch (e) { console.error('[tiktok] handler error', e); } } });

  on(EV.CHAT || 'chat', d => { if (Array.isArray(d.emotes) && d.emotes.length) console.log('[chat] TikTok emotes in message:', JSON.stringify(d.emotes).slice(0, 160)); const w = who(d); Eng.chat(w.id, first(d.comment, d.content, ''), w.name, w.avatar); });
  on(EV.GIFT || 'gift', d => { const w = who(d), g = giftCoins(d); if (g.coins > 0) Eng.gift(w.id, g.coins, g.name, w.name, w.avatar); });
  on(EV.LIKE || 'like', d => { const w = who(d), n = +first(d.likeCount, d.count, 0) || 0; if (n > 0) Eng.like(w.id, n, w.name, w.avatar); });
  on(CE.DISCONNECTED || 'disconnected', () => { status('disconnected, retrying in 10 s...'); retry(seq, username); });
  on(EV.STREAM_END || 'streamEnd', () => { status('the live stream has ended'); });
  on(CE.ERROR || 'error', e => console.error('[tiktok] error:', e && (e.info || e.message || e)));

  status('connecting to @' + username + '...');
  c.connect().then(st => {
    if (seq !== connSeq) return;
    status('connected to @' + username + (st && st.roomId ? ' (room ' + st.roomId + ')' : ''));
    try { Promise.resolve((c.fetchAvailableGifts || c.getAvailableGifts).call(c)).then(g => { if (Array.isArray(g)) for (const x of g) if (x && x.id != null) catalog.set(String(x.id), { name: x.name || '', coins: +x.diamond_count || 0, type: x.type }); }).catch(() => {}); } catch (e) {}   // load the gift price list for coin values
    loadCatalog(st && st.roomId);
  }).catch(err => {
    if (seq !== connSeq) return;
    status('connection failed: ' + (err && (err.message || err.info || err)) + ' — retrying in 10 s');
    retry(seq, username);
  });
}
function retry(seq, username) {
  if (seq !== connSeq) return;
  retryT = setTimeout(() => { retryT = null; if (seq !== connSeq) return; const u = username; conn = null; curUser = ''; connectTikTok(u); }, 10000);
}

/* ================= http + websocket ================= */
const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '/index.html' || p === '/overlay' || p === '/overlay-71.html') {
    fs.readFile(HTML, (err, buf) => {
      if (err) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('overlay HTML not found: ' + HTML); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(buf);
    });
    return;
  }
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, user: curUser, status: Eng.race.status })); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
});

wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.send(JSON.stringify(Eng.snapshot()));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    switch (m.type) {
      case 'connect': connectTikTok(m.username); break;
      case 'config': {
        const d = Math.min(7200, Math.max(10, +m.duration || 60));
        Eng.dur = d; Eng.restart(false); console.log('[game] race length', d, 's'); break;
      }
      case 'restart': Eng.restart(true); break;
      case 'test': {   // from the demo / test panel: chat, then gift, then likes
        const id = String(m.user || 'viewer');
        if (m.text) Eng.chat(id, m.text, id);
        if (+m.gift > 0) Eng.gift(id, +m.gift, m.giftName || '', id);
        if (+m.likes > 0) Eng.like(id, +m.likes, id);
        break;
      }
    }
  });
});

Eng.start();
server.listen(PORT, () => {
  console.log('Overlay:      http://localhost:' + PORT + '/');
  console.log('Test panel:   http://localhost:' + PORT + '/?test');
  if (START_USER) connectTikTok(START_USER);
  else console.log('No TikTok user given: open the overlay menu (☰), type the @username and press "Подключить" (or run: node server.js username)');
});
process.on('uncaughtException', e => console.error('uncaught:', e));
process.on('unhandledRejection', e => console.error('unhandled:', e));
