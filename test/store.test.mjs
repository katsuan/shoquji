// しょくじ：控えの読みこみ・集計のテスト（画面に触らない部分）
//   node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { addLog, exportJson, importJson } from "../js/store.js";
import { menus, totals, logsOf, week, streak, addDays } from "../js/stats.js";

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
  const w = week(s, "2028-03-01");
  assert.deepEqual(w.map((d) => d.date).slice(-3), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(w[6].kcal, 100);
});
