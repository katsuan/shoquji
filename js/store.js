// しょくじ：記録の保存（この端末の localStorage の "shoquji:v1" だけ。サーバーには送らない）
// 記録 1件 = { id, date: "YYYY-MM-DD", meal: "朝"|"昼"|"夜"|"間食", name, kcal, p, f, c, at, upd }
//   kcal・p（たんぱく質）・f（脂質）・c（炭水化物）は数字か null（入れなかった）
//   at は記録した時刻、upd は最後に直した時刻（あとで自分のサーバーとそろえるときに使う）
// sendText：カードで送るとき、カードと一緒に「記録用の文字」も送るか（くらぶボットに読ませる用。はじめはオフ）
// 消した記録の id は deleted に残す（同じく、あとでそろえるとき用。古いものから 500 件まで）
// gasUrl：LINE 版のときに、記録を入れるくらぶボットの GAS の URL（使う人が自分で入れる。秘密ではない。js/linelog.js と同じ形）
// sent：くらぶボットに入れた記録の id（もう一度送らないため。古いものから 2000 件まで）
// app.js と js/ の部品（botlink・card・link・stats）が読む

const KEY = "shoquji:v1";
export const MEALS = ["朝", "昼", "夜", "間食"];
const DEFAULT_TARGETS = { kcal: 2000, p: 65, f: 60, c: 280 };

// 空の記録（はじめて開いたとき・全部消したとき）
function blank() {
  return { v: 1, logs: [], targets: { ...DEFAULT_TARGETS }, deleted: [], sendText: false, gasUrl: "", sent: [] };
}

const MAX_NUM = 99999; // カロリー・PFC・目標の上限
const MAX_LOGS = 20000; // 読みこむ記録の数の上限
const ID_RE = /^[a-z0-9]{1,40}$/i; // newId() の形
const GAS_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,120}\/exec$/; // js/linelog.js の cleanGasUrl と同じ

// 数字を読む（全角の数字・「250kcal」「1,200」も）。数字がなければ null（入れていない）
export function num(v) {
  if (v === null || v === undefined) return null;
  const digits = String(v).normalize("NFKC").replace(/[^\d.]/g, "");
  if (!/\d/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.min(MAX_NUM, Math.round(n * 10) / 10) : null;
}

// 時刻（ミリ秒）。おかしな値は「いま」にする
function time(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e14 ? n : fallback;
}

// 読みこんだ中身を、正しい形にそろえる（壊れた行は捨てる）
function clean(raw) {
  const s = blank();
  if (!raw || typeof raw !== "object") return s;
  const t = raw.targets || {};
  for (const k of Object.keys(DEFAULT_TARGETS)) s.targets[k] = num(t[k]) ?? DEFAULT_TARGETS[k];
  const seen = new Set();
  s.logs = (Array.isArray(raw.logs) ? raw.logs : [])
    .slice(-MAX_LOGS)
    .filter((l) => l && typeof l === "object" && typeof l.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && String(l.name ?? "").trim())
    .map((l) => {
      // id は自分で作った形だけ使う（ちがう形・重なりは作りなおす）
      let id = typeof l.id === "string" && ID_RE.test(l.id) && !seen.has(l.id) ? l.id : newId();
      while (seen.has(id)) id = newId();
      seen.add(id);
      return { l, id };
    })
    .map(({ l, id }) => ({
      id,
      date: l.date,
      meal: MEALS.includes(l.meal) ? l.meal : "間食",
      name: String(l.name).trim().slice(0, 40),
      kcal: num(l.kcal),
      p: num(l.p),
      f: num(l.f),
      c: num(l.c),
      at: time(l.at, Date.now()),
      upd: time(l.upd, time(l.at, Date.now()))
    }));
  s.deleted = (Array.isArray(raw.deleted) ? raw.deleted : []).filter((id) => typeof id === "string" && ID_RE.test(id)).slice(-500);
  s.sendText = raw.sendText === true;
  s.gasUrl = GAS_URL.test(String(raw.gasUrl || "")) ? String(raw.gasUrl) : "";
  s.sent = (Array.isArray(raw.sent) ? raw.sent : []).filter((id) => typeof id === "string" && ID_RE.test(id)).slice(-2000);
  return s;
}

// 記録の id を作る（時刻＋でたらめな文字）
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 端末から記録を読む（読めなければ空）。形を確かめてそろえる
export function load() {
  try {
    return clean(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return blank();
  }
}

// 記録を端末に残す。残せなければ false
export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // 残せない端末（プライベートブラウズなど）でも、開いているあいだは使える
  }
}

// 記録を1件足して、足した記録を返す
export function addLog(state, entry) {
  const now = Date.now();
  const log = { id: newId(), ...normalize(entry), at: now, upd: now };
  state.logs.push(log);
  return log;
}

// 記録を直して、直した記録を返す（なければ null）
export function updateLog(state, id, entry) {
  const log = state.logs.find((l) => l.id === id);
  if (!log) return null;
  Object.assign(log, normalize(entry), { upd: Date.now() });
  return log;
}

// 記録を消し、消した印を残す（あとで生き返らないように）
export function removeLog(state, id) {
  const before = state.logs.length;
  state.logs = state.logs.filter((l) => l.id !== id);
  if (state.logs.length !== before) state.deleted = [...state.deleted, id].slice(-500);
}

// 消した記録を戻す（「元に戻す」）。消した記録の id の控えからも外す
export function restoreLog(state, log) {
  if (!log || state.logs.some((l) => l.id === log.id)) return;
  state.logs.push(log);
  state.deleted = state.deleted.filter((id) => id !== log.id);
}

// 入力の中身を、記録の形にそろえる（食事の種類・名前の長さ・数）
function normalize(e) {
  return {
    date: e.date,
    meal: MEALS.includes(e.meal) ? e.meal : "間食",
    name: String(e.name || "").trim().slice(0, 40),
    kcal: num(e.kcal),
    p: num(e.p),
    f: num(e.f),
    c: num(e.c)
  };
}

// 控え（書き出し・読みこみ）。読みこみは同じ id を上書きし、ほかは足す
export function exportJson(state) {
  return JSON.stringify({ app: "shoquji", exportedAt: new Date().toISOString(), ...state }, null, 1);
}

//   しょくじの控えでないもの（記録の一覧がない）は投げる（画面は「読みこめませんでした」）。目標は控えにあるときだけ
export function importJson(state, text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.logs)) throw new Error("not a shoquji backup");
  const incoming = clean(raw);
  const byId = new Map(state.logs.map((l) => [l.id, l]));
  let added = 0;
  incoming.logs.forEach((l) => {
    const mine = byId.get(l.id);
    if (!mine) {
      byId.set(l.id, l);
      added++;
    } else if (l.upd > mine.upd) {
      byId.set(l.id, l);
    }
  });
  state.logs = [...byId.values()];
  if (raw.targets && typeof raw.targets === "object") state.targets = incoming.targets;
  return added;
}

// くらぶボットに入れた記録の id を覚える
export function markSent(state, ids) {
  const set = new Set(state.sent);
  ids.forEach((id) => ID_RE.test(String(id)) && set.add(String(id)));
  state.sent = [...set].slice(-2000);
}

// 記録を全部消して、空の記録を返す
export function reset() {
  const s = blank();
  save(s);
  return s;
}
