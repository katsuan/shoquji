// しょくじ：集計（画面に関係しない計算だけ）
import { MEALS } from "./store.js?v=1";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export function ymd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

// 今日までの7日（古い順）の合計カロリー
export function week(state, today) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, kcal: totals(logsOf(state, date)).kcal, count: logsOf(state, date).length };
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

export function fmt(n) {
  return n == null ? "" : Number(n).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}
