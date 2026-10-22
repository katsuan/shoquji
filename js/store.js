// しょくじ：記録の保存（この端末の localStorage の "shoquji:v1" だけ。サーバーには送らない）
// 記録 1件 = { id, date: "YYYY-MM-DD", meal: "朝"|"昼"|"夜"|"間食", name, kcal, p, f, c, at, upd }
//   kcal・p（たんぱく質）・f（脂質）・c（炭水化物）は数字か null（入れなかった）
//   at は記録した時刻、upd は最後に直した時刻（あとで自分のサーバーとそろえるときに使う）
// sendText：LINE で送るとき、カードと一緒に「記録用の文字」も送るか（食事記録ボットに読ませる用。はじめはオフ）
// 消した記録の id は deleted に残す（同じく、あとでそろえるとき用。古いものから 500 件まで）

const KEY = "shoquji:v1";
export const MEALS = ["朝", "昼", "夜", "間食"];
export const DEFAULT_TARGETS = { kcal: 2000, p: 65, f: 60, c: 280 };

function blank() {
  return { v: 1, logs: [], targets: { ...DEFAULT_TARGETS }, deleted: [], sendText: false };
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

// 読みこんだ中身を、正しい形にそろえる（壊れた行は捨てる）
function clean(raw) {
  const s = blank();
  if (!raw || typeof raw !== "object") return s;
  const t = raw.targets || {};
  for (const k of Object.keys(DEFAULT_TARGETS)) s.targets[k] = num(t[k]) ?? DEFAULT_TARGETS[k];
  s.logs = (Array.isArray(raw.logs) ? raw.logs : [])
    .filter((l) => l && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && String(l.name || "").trim())
    .map((l) => ({
      id: String(l.id || newId()),
      date: l.date,
      meal: MEALS.includes(l.meal) ? l.meal : "間食",
      name: String(l.name).trim().slice(0, 40),
      kcal: num(l.kcal),
      p: num(l.p),
      f: num(l.f),
      c: num(l.c),
      at: Number(l.at) || Date.now(),
      upd: Number(l.upd) || Number(l.at) || Date.now()
    }));
  s.deleted = (Array.isArray(raw.deleted) ? raw.deleted : []).map(String).slice(-500);
  s.sendText = raw.sendText === true;
  return s;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function load() {
  try {
    return clean(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return blank();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // 残せない端末（プライベートブラウズなど）でも、開いているあいだは使える
  }
}

export function addLog(state, entry) {
  const now = Date.now();
  const log = { id: newId(), ...normalize(entry), at: now, upd: now };
  state.logs.push(log);
  return log;
}

export function updateLog(state, id, entry) {
  const log = state.logs.find((l) => l.id === id);
  if (!log) return null;
  Object.assign(log, normalize(entry), { upd: Date.now() });
  return log;
}

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

export function importJson(state, text) {
  const incoming = clean(JSON.parse(text));
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
  state.targets = incoming.targets;
  return added;
}

export function reset() {
  const s = blank();
  save(s);
  return s;
}
