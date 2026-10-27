// まだ送っていない記録：電波なし → もどる、ログインなし、2回送らない（js/outbox.js）
import test from "node:test";
import assert from "node:assert/strict";
import { createOutbox, isOffline, saveNoteText, unsentLogs } from "../js/outbox.js";
import { addLog, load, markSent, save } from "../js/store.js";

const log = (id, date) => ({ id, date, meal: "昼", name: "おにぎり", kcal: 180 });

test("まだ送っていないのは、ここ7日の、sent にないものだけ", () => {
  const state = { logs: [log("a", "2026-10-28"), log("b", "2026-10-22"), log("old", "2026-10-21"), log("c", "2026-10-27")], sent: ["c"] };
  assert.deepEqual(unsentLogs(state, "2026-10-28").map((l) => l.id), ["a", "b"]);
});

test("電波なし → もどる：送れなかった記録は残り、もどったら送れて、もう出ない", async () => {
  const state = { logs: [log("a", "2026-10-28")], sent: [] };
  let online = false;
  const calls = [];
  const box = createOutbox(async (logs) => {
    calls.push(logs.map((l) => l.id));
    return online ? { ok: true, added: logs.map((l) => l.id) } : { ok: false, error: "net" };
  });
  const first = await box.push(unsentLogs(state, "2026-10-28"));
  assert.equal(first.error, "net");
  assert.equal(unsentLogs(state, "2026-10-28").length, 1, "送れなかった記録は「まだ」のまま");
  online = true;
  const res = await box.push(unsentLogs(state, "2026-10-28"));
  assert.ok(res.ok);
  markSent(state, ["a"]);
  assert.equal(unsentLogs(state, "2026-10-28").length, 0);
  assert.deepEqual(calls, [["a"], ["a"]]);
});

test("送る途中で投げても止まらない（電波なしとして残す）", async () => {
  const box = createOutbox(async () => {
    throw new Error("offline");
  });
  assert.deepEqual(await box.push([log("a", "2026-10-28")]), { ok: false, error: "net" });
  assert.equal(box.flying("a"), false);
});

test("2回送らない：送っている途中の記録を、もう一度は送らない", async () => {
  const releases = [];
  const calls = [];
  const box = createOutbox((logs) => {
    calls.push(logs.map((l) => l.id));
    return new Promise((r) => releases.push(() => r({ ok: true })));
  });
  const a = log("a", "2026-10-28");
  const b = log("b", "2026-10-28");
  const p1 = box.push([a]); // 記録したときの送り
  const p2 = box.push([a, b]); // 同時に「まだの分」を送る
  const p3 = box.push([a]);
  assert.deepEqual(await p3, { ok: true, none: true });
  releases.forEach((r) => r());
  await Promise.all([p1, p2]);
  assert.deepEqual(calls, [["a"], ["b"]]);
});

test("ログインしていない：記録は端末に残る", () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const state = load();
  addLog(state, { date: "2026-10-28", meal: "昼", name: "おにぎり", kcal: 180 });
  assert.equal(save(state), true);
  assert.equal(load().logs.length, 1);
  assert.equal(unsentLogs(load(), "2026-10-28").length, 1, "つながったら送る分として数える");
  delete globalThis.localStorage;
});

test("端末に残せない（プライベートブラウズなど）ときも、エラーで止まらない", () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(save(load()), false);
  delete globalThis.localStorage;
});

test("画面の1行", () => {
  assert.equal(saveNoteText({ inLine: true, pending: 2, loggedIn: true }), "📮 2件 まだ送っていません（つながったら送ります）");
  assert.equal(saveNoteText({ inLine: true, pending: 0, loggedIn: false }), "👤 ログインしていません。記録はこの端末に保存中");
  assert.equal(saveNoteText({ inLine: true, pending: 0, loggedIn: true }), "");
  assert.equal(saveNoteText({ inLine: false, pending: 0, loggedIn: false }), "", "ブラウザ版はいつも端末なので出さない");
});

test("電波：onLine が false のときだけ「ない」", () => {
  assert.equal(isOffline({ onLine: false }), true);
  assert.equal(isOffline({ onLine: true }), false);
  assert.equal(isOffline(null), false);
});
