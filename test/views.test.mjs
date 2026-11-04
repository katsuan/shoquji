// しょくじ：画面に出す中身（js/views.js）と、記録用の文字（js/card.js）のテスト
//   node --test test/
import "./_botlink.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { totals, week } from "../js/stats.js";
import { recordText } from "../js/card.js";
import { dayListHtml, estOptions, formTexts, itemHtml, mealBarHtml, mealClass, mealSplitHtml, pct, rangeLabel, totalsHtml, weekHtml, weekName } from "../js/views.js";

const XSS = "<img src=x onerror=alert(1)>"; // qcheck-ok: W8 外からの文字の見本
const goal = { kcal: 2000, p: 65, f: 60, c: 280 };
const log = (o) => ({ id: "a1", date: "2026-11-05", meal: "朝", name: "トースト", kcal: 250, p: null, f: null, c: null, at: 1, upd: 1, ...o });

test("食事の色は朝・昼・夜・間食の順に m0〜m3（知らない食事は m0）", () => {
  assert.deepEqual(["朝", "昼", "夜", "間食", "?"].map(mealClass), ["m0", "m1", "m2", "m3", "m0"]);
});

test("目標にしめる割合は 100 まで。目標がなければ 0", () => {
  assert.equal(pct(500, 2000), 25);
  assert.equal(pct(3000, 2000), 100);
  assert.equal(pct(500, 0), 0);
});

test("目標をこえた日だけ、バーに目標の線と over の印", () => {
  const rows = [{ meal: "朝", kcal: 2500, pct: 100 }, { meal: "昼", kcal: 0, pct: 0 }];
  const over = mealBarHtml(rows, 2500, { over: true, goal: 2000 });
  assert.match(over, /class="bar stack over"/);
  assert.match(over, /goal-mark" style="left:80%/);
  assert.equal((over.match(/<i /g) || []).length, 1, "カロリーのない食事は出さない");
  assert.doesNotMatch(mealBarHtml(rows, 2500), /goal-mark|over/);
});

test("食事ごとの割合：カロリーがひとつもなければ出さない。平均を渡すと「平均」と1日あたり", () => {
  assert.equal(mealSplitHtml([{ meal: "朝", kcal: 0, pct: 0 }]), "");
  const html = mealSplitHtml([{ meal: "朝", kcal: 700, pct: 100 }, { meal: "昼", kcal: 0, pct: 0 }], 7);
  assert.match(html, /<small>平均<\/small><small>100 kcal<\/small>/);
  assert.match(html, /m1 is-zero/, "記録のない食事は薄く");
});

test("合計：PFC は入れた品がある日だけ。カロリーのない品はその数を知らせる", () => {
  const logs = [log({}), log({ id: "a2", name: "チョコ", kcal: null })];
  const html = totalsHtml(logs, totals(logs), goal);
  assert.match(html, /250<small>kcal/);
  assert.match(html, /目標 2,000 kcal（13%）/);
  assert.doesNotMatch(html, /class="pfc"/);
  assert.match(html, /入れていないものが 1 件/);
  const withPfc = [log({ p: 8, f: 6, c: 40 })];
  assert.match(totalsHtml(withPfc, totals(withPfc), goal), /class="pfc"[\s\S]*たんぱく質<b>8/);
});

test("一覧：名前は esc して入れ、直している品・記録したばかりの品に印", () => {
  const html = dayListHtml([log({ name: XSS }), log({ id: "a2", meal: "夜" })], { editing: "a1", justAdded: "a2" });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /item is-editing/);
  assert.match(html, /item is-new/);
  assert.equal((html.match(/meal-group/g) || []).length, 2, "記録のある食事だけ");
  assert.match(html, /data-icon="close"/);
});

test("ボットの記録：つないでいるときだけ、直す・消すのボタン", () => {
  const bot = { bot: true, logId: "L1", name: "牛丼", kcal: 650, meal: "昼" };
  assert.doesNotMatch(itemHtml(bot), /data-bot-edit|data-bot-del/);
  const linked = itemHtml(bot, { botLinked: true, botEdit: "L1" });
  assert.match(linked, /data-bot-edit="L1"/);
  assert.match(linked, /data-bot-del="L1"/);
  assert.match(linked, /is-bot is-editing/);
});

test("週の呼び方と日付のはば", () => {
  assert.deepEqual([0, -1, -2].map(weekName), ["今週", "先週", "この週"]);
  assert.equal(rangeLabel("2026-11-02", "2026-11-08"), "11/2〜11/8");
});

test("1週間の棒：目標の線の高さ、きょう・先の日の印、曜日", () => {
  const state = { logs: [log({ date: "2026-11-03", kcal: 2400 })] };
  const days = week(state, "2026-11-05", { start: 1 });
  const html = weekHtml(days, { today: "2026-11-05", goal: 2000 });
  // いちばん高い 2400 の目盛りで、目標 2000 は 16 + 110 × (1 − 2000/2400) ≈ 34.3px
  assert.match(html, /class="goal" style="top:34\.33/);
  assert.equal((html.match(/day-col/g) || []).length, 7);
  assert.match(html, /day-col today/);
  assert.match(html, /day-col future/);
  assert.match(html, /<span class="dow">月<\/span>/);
});

test("ご飯何杯分：朝・昼・夜は½〜3杯、間食は「少し」から。1杯 240kcal", () => {
  assert.deepEqual(estOptions("朝").map((o) => [o.label, o.kcal]), [["½杯", 120], ["1杯", 240], ["1.5杯", 360], ["2杯", 480], ["3杯", 720]]);
  assert.deepEqual(estOptions("間食").map((o) => o.key), ["few", "0.5", "1", "1.5"]);
});

test("入力欄の見出しと保存のボタン：記録する・直す・ボットの記録・MYメニュー", () => {
  assert.deepEqual(formTexts({ date: "2026-11-05" }, 0), { heading: "記録する（きょう）", saveIcon: "add", saveText: "記録する" });
  assert.equal(formTexts({ date: "2026-11-04" }, null).heading, "記録する（11/4（水））");
  assert.deepEqual(formTexts({ editing: "a1" }, 0), { heading: "記録を直す", saveIcon: "edit", saveText: "直す" });
  assert.equal(formTexts({ botEdit: "L1" }, 0).heading, "ボットの記録を直す");
  assert.deepEqual(formTexts({ masterEdit: { toMine: true } }, 0), { heading: "共通の MYメニューを自分用にする", saveIcon: "save", saveText: "自分用に保存" });
  assert.equal(formTexts({ masterEdit: {} }, 0).saveText, "MYメニューに保存");
});

test("記録用の文字（くらぶボットが読む形）：#しょくじ 日付、1品1行で入れた数字だけ", () => {
  const text = recordText("2026-11-05", [log({ p: 8 }), log({ meal: "夜", name: "焼き  魚", kcal: null })]);
  assert.equal(text, "#しょくじ 2026/11/05\n朝 トースト 250kcal P8\n夜 焼き 魚");
});
