// しょくじ：くらぶボットのカード・メニューから開いたときの指定（js/link.js）のテスト
//   node --test test/
import "./_botlink.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readLink } from "../js/link.js";
import { addDays, ymd } from "../js/stats.js";

const BASE = "https://katsuan.github.io/shoquji/";

test("指定がなければ、どれも空", () => {
  const l = readLink(BASE);
  assert.equal(l.mode, "");
  assert.equal(l.meal, "");
  assert.equal(l.date, "");
  assert.equal(l.menu, "");
  assert.equal(l.logId, "");
});

test("食事・名前・数字・どこを見るかを読む（「その他」は間食）", () => {
  const l = readLink(`${BASE}?mode=input&meal=%E3%81%9D%E3%81%AE%E4%BB%96&menu=%E3%82%AB%E3%83%AC%E3%83%BC&kcal=780&protein=20`);
  assert.equal(l.mode, "input");
  assert.equal(l.meal, "間食");
  assert.equal(l.menu, "カレー");
  assert.equal(l.nums.kcal, 780);
  assert.equal(l.nums.p, 20);
  assert.equal(l.nums.f, null);
});

test("LINE の外で liff.line.me から開いたとき（liff.state の中）も読む", () => {
  const state = encodeURIComponent("/?mode=summary&meal=夜");
  const l = readLink(`${BASE}?liff.state=${state}`);
  assert.equal(l.mode, "summary");
  assert.equal(l.meal, "夜");
});

test("知らない値・形のちがう値は受けとらない", () => {
  const l = readLink(`${BASE}?mode=hack&meal=朝ごはん&logId=${encodeURIComponent("a/b")}&masterKey=${encodeURIComponent("x y")}`);
  assert.equal(l.mode, "");
  assert.equal(l.meal, "");
  assert.equal(l.logId, "");
  assert.equal(l.masterKey, "");
});

test("日付：きのう（datePreset）と、先の日は受けとらない", () => {
  assert.equal(readLink(`${BASE}?datePreset=yesterday`).date, addDays(ymd(), -1));
  assert.equal(readLink(`${BASE}?mealDate=${addDays(ymd(), 1)}`).date, "");
  assert.equal(readLink(`${BASE}?mealDate=2026-11-01`).date, "2026-11-01");
});

test("名前は 40 字まで、メモは 200 字まで", () => {
  const l = readLink(`${BASE}?menu=${"あ".repeat(60)}&note=${"い".repeat(300)}`);
  assert.equal(l.menu.length, 40);
  assert.equal(l.keep.note.length, 200);
});
