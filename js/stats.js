// しょくじ：日付と集計の計算（合計・食事ごとの割合・よく食べるもの・1週間・続けた日数）。画面にはさわらない。
// app.js と js/ のほかの部品が読む
import { MEALS } from "./store.js?v=202610271256";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// 日付を「2026-10-25」の形にする（端末の時刻で）
export function ymd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 「2026-10-25」の n 日あと（マイナスなら前）を返す
export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

// 「10/22（水）」
export function label(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}

// いまの時刻から、朝・昼・夜・間食のどれか（入力のはじめの選択）
export function mealNow(d = new Date()) {
  const h = d.getHours();
  if (h >= 4 && h < 10) return "朝";
  if (h >= 10 && h < 15) return "昼";
  if (h >= 17 && h < 23) return "夜";
  return "間食";
}

// その日の記録を、朝・昼・夜・間食、記録した順に並べて返す
export function logsOf(state, date) {
  return state.logs.filter((l) => l.date === date).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.at - b.at);
}

// 1日の合計（入れていない数字は 0 として足す。入れた件数も返す）
export function totals(logs) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, count: logs.length, withKcal: 0 };
  logs.forEach((l) => {
    ["kcal", "p", "f", "c"].forEach((k) => (t[k] += l[k] || 0));
    if (l.kcal != null) t.withKcal++;
  });
  ["kcal", "p", "f", "c"].forEach((k) => (t[k] = Math.round(t[k] * 10) / 10));
  return t;
}

// 食事ごと（朝・昼・夜・間食）のカロリーと、合計にしめる割合（%）。割合は足して 100 になるように丸める
//   [{ meal: "朝", kcal: 450, pct: 30 }, …]（MEALS の順。カロリーのない食事は kcal 0・pct 0）
export function byMeal(logs) {
  const rows = MEALS.map((meal) => ({ meal, kcal: Math.round(logs.filter((l) => l.meal === meal).reduce((n, l) => n + (l.kcal || 0), 0) * 10) / 10, pct: 0 }));
  const sum = rows.reduce((n, r) => n + r.kcal, 0);
  if (sum <= 0) return rows;
  // 切り捨ててから、端数の大きい順に 1 ずつ足す（四捨五入だと 99・101 になることがある）
  const raw = rows.map((r) => (r.kcal / sum) * 100);
  rows.forEach((r, i) => (r.pct = Math.floor(raw[i])));
  let left = 100 - rows.reduce((n, r) => n + r.pct, 0);
  raw
    .map((v, i) => [v - Math.floor(v), i])
    .sort((x, y) => y[0] - x[0])
    .forEach(([, i]) => {
      if (left > 0 && rows[i].kcal > 0) {
        rows[i].pct++;
        left--;
      }
    });
  return rows;
}

// 食べたものの一覧（名前ごと）：回数・最後の栄養。よく食べる順
export function menus(state) {
  const map = new Map();
  [...state.logs].sort((a, b) => a.upd - b.upd).forEach((l) => {
    const key = l.name;
    const m = map.get(key) || { name: key, count: 0 };
    m.count++;
    // 最後に入れた数字を使う（入れていない数字は前のものを残す）
    ["kcal", "p", "f", "c"].forEach((k) => {
      if (l[k] != null) m[k] = l[k];
    });
    m.last = Math.max(m.last || 0, l.at);
    map.set(key, m);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

// その日をふくむ週の、はじまりの日（start：1＝月曜・0＝日曜。Q 共通の週のはじまり）
export function weekStartOf(date, start = 1) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return addDays(date, -((dow - (start === 0 ? 0 : 1) + 7) % 7));
}

// きょうをふくむ週から offset 週ずらした週の7日（週のはじまりから順に）の、合計カロリーと食事ごとのカロリー（meals）。
// きょうより先の日は future: true（記録はまだないので空で出す）
export function week(state, today, { start = 1, offset = 0 } = {}) {
  const first = addDays(weekStartOf(today, start), offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(first, i);
    const logs = logsOf(state, date);
    const t = totals(logs);
    return { date, kcal: t.kcal, count: t.count, meals: byMeal(logs), future: date > today };
  });
}

// 続けて記録した日数（今日まだ記録がなければ、昨日までで数える）
export function streak(state, today) {
  const days = new Set(state.logs.map((l) => l.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// 数を「1,234.5」の形にする（null なら ""）
export function fmt(n) {
  return n == null ? "" : Number(n).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}
