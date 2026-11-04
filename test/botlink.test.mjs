// しょくじ：くらぶボットとのつなぎ（js/botlink.js）のうち、まだ送っていない記録の数（見出しのアイコンの印）のテスト
//   いつものくらぶボットを使っていない人には出さず、前につながって使っているとわかった人・自分のつなぎ先を入れた人には出す
//   node --test test/
import "./_botlink.mjs";
import test from "node:test";
import assert from "node:assert/strict";

// LINE のアプリの中で開いた形にする（端末・画面の代わり）
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (iPhone) Line/14.0.0", onLine: true }, configurable: true });
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = { visibilityState: "visible", addEventListener() {}, getElementById: () => ({}) };
globalThis.window = globalThis;

const { createBotLink } = await import("../js/botlink.js");
const { LINE_LOG } = await import("../js/line-config.js");
const { rememberBot, BOT_SEEN_KEY } = await import("../js/outbox.js");
const { addDays, ymd } = await import("../js/stats.js");

const OWN = "https://script.google.com/macros/s/AKfyOWN_1234567890/exec";
const log = (id) => ({ id, date: addDays(ymd(), -1), meal: "朝", name: "トースト", kcal: 250, p: null, f: null, c: null, at: 1, upd: 1 });
function link(gasUrl = "") {
  const state = { v: 1, logs: [log("a1"), log("a2")], targets: {}, deleted: [], sendText: false, gasUrl, sent: [] };
  return createBotLink({ state: () => state, ui: {}, link: {}, render() {}, persist() {}, say() {}, cancelEdit() {}, startBotEdit() {}, changed() {} });
}

test("いつものくらぶボットを使っているかまだわからない人（使っていない人）には、まだ送っていない数を出さない", () => {
  rememberBot("");
  assert.equal(link().pending(), 0);
});

test("前にいつものくらぶボットにつながって使っているとわかった人には、まだ送っていない数を出す", () => {
  rememberBot(LINE_LOG.gasUrl);
  assert.equal(link().pending(), 2);
  rememberBot("");
});

test("自分のつなぎ先を入れた人には、いつも出す", () => {
  rememberBot("");
  assert.equal(link(OWN).pending(), 2);
});

test("つながったくらぶボットを覚える場所は、ボットの記録の控え（shoquji:bot）と別", () => {
  assert.notEqual(BOT_SEEN_KEY, "shoquji:bot");
});
