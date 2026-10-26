// しょくじ：控えの読みこみ・集計のテスト（画面に触らない部分）
//   node --test test/
import "./_botlink.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { addLog, exportJson, importJson } from "../js/store.js";
import { byMeal, menus, totals, logsOf, week, weekStartOf, streak, addDays } from "../js/stats.js";

const XSS = "<img src=x onerror=alert(1)>"; // qcheck-ok: W8 外からの文字の見本
const blank = () => ({ v: 1, logs: [], targets: { kcal: 2000, p: 65, f: 60, c: 280 }, deleted: [], sendText: false });

test("書き出した控えを読みこむと、同じ記録が戻る", () => {
  const a = blank();
  addLog(a, { date: "2026-10-22", meal: "朝", name: "トースト", kcal: "250", p: 8 });
  const b = blank();
  assert.equal(importJson(b, exportJson(a)), 1);
  assert.equal(b.logs[0].name, "トースト");
  assert.equal(b.logs[0].kcal, 250);
});

test("壊れた控え（JSON でない）は投げる（画面は「読みこめませんでした」）", () => {
  assert.throws(() => importJson(blank(), "not json{"));
});

test("形のちがう中身は捨てるか、決まった形にそろえる", () => {
  const s = blank();
  const raw = {
    targets: { kcal: "1e999", p: XSS },
    logs: [
      null,
      "x",
      { date: XSS, name: "a" },
      { date: "2026-10-22", name: "" },
      { id: `">${XSS}`, date: "2026-10-22", meal: XSS, name: XSS, kcal: "99999999", at: "Infinity" },
      { id: "abc123", date: "2026-10-22", meal: "夜", name: "x".repeat(5000), kcal: { a: 1 } },
      { id: "abc123", date: "2026-10-22", meal: "夜", name: "同じ id" }
    ],
    deleted: [XSS, "ok1", 5]
  };
  importJson(s, JSON.stringify(raw));
  assert.equal(s.logs.length, 3);
  for (const l of s.logs) {
    assert.match(l.id, /^[a-z0-9]{1,40}$/i, "id は決まった形だけ");
    assert.ok(["朝", "昼", "夜", "間食"].includes(l.meal));
    assert.ok(l.name.length <= 40);
    assert.ok(Number.isFinite(l.at));
    assert.ok(l.kcal === null || l.kcal <= 99999);
  }
  assert.equal(new Set(s.logs.map((l) => l.id)).size, 3, "id が重ならない");
  // 名前の文字はそのまま残る（画面では esc して出す）
  assert.equal(s.logs[0].name, XSS);
  assert.ok(s.targets.kcal <= 99999);
});

test("記録の数が多すぎても、上限までで止まる", () => {
  const logs = Array.from({ length: 25000 }, (_, i) => ({ date: "2026-10-22", name: "a" + i }));
  const s = blank();
  importJson(s, JSON.stringify({ logs }));
  assert.equal(s.logs.length, 20000);
});

test("集計：入れていない数字は 0 として足す", () => {
  const s = blank();
  addLog(s, { date: "2026-10-22", meal: "朝", name: "パン", kcal: 200 });
  addLog(s, { date: "2026-10-22", meal: "昼", name: "おにぎり" });
  addLog(s, { date: "2026-10-22", meal: "夜", name: "パン", kcal: 210 });
  const t = totals(logsOf(s, "2026-10-22"));
  assert.equal(t.kcal, 410);
  assert.equal(t.withKcal, 2);
  assert.equal(menus(s)[0].name, "パン");
  assert.equal(menus(s)[0].kcal, 210);
});

test("全角の数字も読む。数字でない文字は「入れていない」にする", () => {
  const s = blank();
  const l = addLog(s, { date: "2026-10-22", meal: "朝", name: "パン", kcal: "２５０", p: "８．５", f: "abc", c: "1,200" });
  assert.equal(l.kcal, 250);
  assert.equal(l.p, 8.5);
  assert.equal(l.f, null, "数字でない文字を 0 にしない");
  assert.equal(l.c, 1200);
});

test("しょくじの控えでないファイルは投げて、目標も変えない", () => {
  for (const text of ["[]", "{}", '{"foo":1}', "null", '"x"']) {
    const s = blank();
    s.targets.kcal = 1800;
    assert.throws(() => importJson(s, text), text);
    assert.equal(s.targets.kcal, 1800);
  }
});

test("目標の入っていない控えを読んでも、いまの目標を残す", () => {
  const s = blank();
  s.targets.kcal = 1800;
  importJson(s, JSON.stringify({ logs: [{ date: "2026-10-22", name: "パン" }] }));
  assert.equal(s.targets.kcal, 1800);
  assert.equal(s.logs.length, 1);
});

test("つづくが読む形：logs[].date は YYYY-MM-DD のまま", () => {
  const a = blank();
  addLog(a, { date: "2026-10-22", meal: "朝", name: "パン" });
  const saved = JSON.parse(exportJson(a));
  assert.ok(Array.isArray(saved.logs));
  assert.match(saved.logs[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test("日付：月・年・うるう年をまたいでも1日ずつ数える", () => {
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(addDays("2027-03-01", -1), "2027-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  const s = blank();
  ["2028-02-28", "2028-02-29", "2028-03-01"].forEach((date) => addLog(s, { date, meal: "朝", name: "パン", kcal: 100 }));
  assert.equal(streak(s, "2028-03-01"), 3);
  assert.equal(streak(s, "2028-03-02"), 3, "きょうまだなら、きのうまでで数える");
  // 2028-03-01 は水曜。月曜はじまりの週は 2/28（月）〜3/5（日）
  const w = week(s, "2028-03-01");
  assert.deepEqual(w.map((d) => d.date).slice(0, 3), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(w[2].kcal, 100);
  assert.equal(w[3].future, true, "きょうより先の日");
});

test("食事ごとの割合：足して 100%、カロリーのない食事は 0%", () => {
  const rows = byMeal([
    { meal: "朝", kcal: 100 },
    { meal: "昼", kcal: 100 },
    { meal: "夜", kcal: 100 },
    { meal: "夜", kcal: null }
  ]);
  assert.deepEqual(rows.map((r) => r.meal), ["朝", "昼", "夜", "間食"]);
  assert.deepEqual(rows.map((r) => r.kcal), [100, 100, 100, 0]);
  assert.equal(rows.reduce((n, r) => n + r.pct, 0), 100);
  assert.equal(rows[3].pct, 0);
  assert.deepEqual(byMeal([]).map((r) => r.pct), [0, 0, 0, 0]);
});

test("1週間の日ごとに、食事ごとのカロリーも入る", () => {
  const s = blank();
  addLog(s, { date: "2026-10-22", meal: "昼", name: "カレー", kcal: 780 });
  addLog(s, { date: "2026-10-22", meal: "間食", name: "せんべい", kcal: 120 });
  const day = week(s, "2026-10-22").find((d) => d.date === "2026-10-22");
  assert.equal(day.kcal, 900);
  assert.deepEqual(day.meals.map((r) => [r.meal, r.kcal, r.pct]), [["朝", 0, 0], ["昼", 780, 87], ["夜", 0, 0], ["間食", 120, 13]]);
});

test("週の区切り：月曜はじまり・日曜はじまり。前の週へずらすと、週・年をまたいでも7日ずつ", () => {
  // 2026-10-26 は月曜、2026-10-25 は日曜
  assert.equal(weekStartOf("2026-10-26", 1), "2026-10-26");
  assert.equal(weekStartOf("2026-10-25", 1), "2026-10-19", "月曜はじまりなら、日曜は週の最後");
  assert.equal(weekStartOf("2026-10-25", 0), "2026-10-25");
  assert.equal(weekStartOf("2026-10-31", 0), "2026-10-25");
  const s = blank();
  addLog(s, { date: "2026-12-31", meal: "夜", name: "そば", kcal: 400 });
  addLog(s, { date: "2027-01-01", meal: "朝", name: "おもち", kcal: 300 });
  // 2027-01-01 は金曜。月曜はじまりなら 12/28〜1/3、日曜はじまりなら 12/27〜1/2
  const mon = week(s, "2027-01-01", { start: 1 });
  assert.deepEqual([mon[0].date, mon[6].date], ["2026-12-28", "2027-01-03"]);
  assert.deepEqual(mon.filter((d) => d.kcal).map((d) => [d.date, d.kcal]), [["2026-12-31", 400], ["2027-01-01", 300]]);
  const sun = week(s, "2027-01-01", { start: 0 });
  assert.deepEqual([sun[0].date, sun[6].date], ["2026-12-27", "2027-01-02"]);
  const prev = week(s, "2027-01-01", { start: 1, offset: -1 });
  assert.deepEqual([prev[0].date, prev[6].date], ["2026-12-21", "2026-12-27"]);
  assert.ok(prev.every((d) => !d.future));
});
