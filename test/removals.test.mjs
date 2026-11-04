// しょくじ：消すのを「元に戻す」の時間だけ待つ（js/removals.js）と、つづくに渡す記録のある日（js/days.js）のテスト
//   node --test test/
import "./_botlink.mjs";
import test from "node:test";
import assert from "node:assert/strict";

// 時計の代わり（setTimeout・clearTimeout）。tick(ms) で時間を進める
let now = 0;
const timers = new Map();
let seq = 0;
globalThis.setTimeout = (fn, ms) => (timers.set(++seq, { fn, at: now + ms }), seq);
globalThis.clearTimeout = (id) => timers.delete(id);
function tick(ms) {
  now += ms;
  for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
    if (t.at <= now && timers.has(id)) {
      timers.delete(id);
      t.fn();
    }
  }
}

// removals.js は読んだときに document の visibilitychange を聞くので、その代わりを置く
const listeners = {};
globalThis.document = { visibilityState: "visible", addEventListener: (type, fn) => (listeners[type] = fn) };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const { queueRemoval, cancelRemoval, isWaiting, waitingOwnIds } = await import("../js/removals.js");
const { writeDays } = await import("../js/days.js");

test("消すのは「元に戻す」の時間（6.5 秒）がすぎてから。待っているあいだは取りやめられる", () => {
  const runs = [];
  queueRemoval("own:a1", (keepalive) => runs.push(["a1", keepalive]));
  queueRemoval("bot:L9", (keepalive) => runs.push(["L9", keepalive]));
  assert.equal(isWaiting("own:a1"), true);
  assert.deepEqual([...waitingOwnIds()], ["a1"], "待っているしょくじの記録の id だけ");
  tick(6000);
  assert.deepEqual(runs, []);
  cancelRemoval("bot:L9"); // 「元に戻す」
  tick(600);
  assert.deepEqual(runs, [["a1", false]]);
  assert.equal(isWaiting("own:a1"), false);
});

test("同じ記録をもう一度消すと、前の待ちは取りやめて、待ちなおす", () => {
  const runs = [];
  queueRemoval("own:b1", () => runs.push("first"));
  tick(5000);
  queueRemoval("own:b1", () => runs.push("second"));
  tick(5000);
  assert.deepEqual(runs, []);
  tick(2000);
  assert.deepEqual(runs, ["second"]);
});

test("ページを閉じる・ほかのアプリに切りかえるときは、待たずにすぐ送る（keepalive）", () => {
  const runs = [];
  queueRemoval("own:c1", (keepalive) => runs.push(keepalive));
  document.visibilityState = "hidden";
  listeners.visibilitychange();
  document.visibilityState = "visible";
  assert.deepEqual(runs, [true]);
  assert.equal(isWaiting("own:c1"), false);
});

test("つづくに渡す記録のある日：日付だけを古い順に、重なりなし。変わったときだけ書く", () => {
  writeDays([{ date: "2026-11-05" }, { date: "2026-11-03" }, { date: "2026-11-05" }, { date: "だめな日付" }]);
  assert.equal(mem.get("shoquji:days"), JSON.stringify({ v: 1, days: ["2026-11-03", "2026-11-05"] }));
  mem.set("shoquji:days", "ほかで書きかえた");
  writeDays([{ date: "2026-11-03" }, { date: "2026-11-05" }]);
  assert.equal(mem.get("shoquji:days"), "ほかで書きかえた", "同じ中身なら書かない");
});
