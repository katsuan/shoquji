// しょくじ：LINE の中（LIFF）で開いたときの、食事記録ボットとのつなぎのテスト（画面に触らない部分）
//   node --test test/
// つくりは、つづく（q-tuzuq）の test/linelog.test.mjs を写したもの
import test from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};
const { botLogsForView, cleanGasUrl, fromBotMeal, inLineApp, lineLogMessage, makeClient, startLineLog, toBotMeal } = await import("../js/linelog.js");
const store = await import("../js/store.js");

const GAS = "https://script.google.com/macros/s/AKfyTEST_123/exec";
const TOKEN = "head.payload.sign";
const okFetch = (reply, seen) => async (url, opt) => {
  seen.push({ url, opt, body: JSON.parse(opt.body) });
  return { json: async () => reply };
};

test("ボットに送るのは ID トークンと記録だけ（userId は送らない）。text/plain。間食は「その他」、id は clientId に", async () => {
  const seen = [];
  const c = makeClient(GAS, () => TOKEN, okFetch({ ok: true, added: [{}] }, seen));
  const res = await c.record([{ id: "abc123", date: "2026-10-24", meal: "間食", name: "プリン", kcal: 200, p: 5, f: null, c: 30 }]);
  assert.equal(res.ok, true);
  assert.equal(seen[0].url, GAS);
  assert.equal(seen[0].opt.method, "POST");
  assert.match(seen[0].opt.headers["Content-Type"], /^text\/plain/);
  assert.deepEqual(seen[0].body, {
    idToken: TOKEN,
    action: "submitMealBatch",
    source: "shoquji",
    dedupe: false,
    sendLineSummary: false,
    items: [{ clientId: "abc123", mealDate: "2026-10-24", meal: "その他", menu: "プリン", kcal: 200, protein: 5, fat: null, carb: 30 }]
  });
  assert.ok(!("userId" in seen[0].body));
  await c.list("2026-09-01", "2026-10-24");
  assert.deepEqual(seen[1].body, { idToken: TOKEN, action: "listMealLogs", from: "2026-09-01", to: "2026-10-24" });
});

test("ID トークンがないときは送らない。通信できないときは net。ボットのやさしい文は短い印に", async () => {
  const seen = [];
  const none = makeClient(GAS, () => "", okFetch({ ok: true }, seen));
  assert.deepEqual(await none.list("2026-10-01", "2026-10-24"), { ok: false, error: "auth" });
  assert.equal(seen.length, 0);
  const down = makeClient(GAS, () => TOKEN, async () => { throw new Error("offline"); });
  assert.deepEqual(await down.list("2026-10-01", "2026-10-24"), { ok: false, error: "net" });
  const said = (error) => makeClient(GAS, () => TOKEN, async () => ({ json: async () => ({ ok: false, error }) })).list("2026-10-01", "2026-10-24");
  assert.equal((await said("LINE でアプリを開きなおしてください（本人確認ができませんでした）")).error, "auth");
  assert.equal((await said("管理者の許可待ちです。")).error, "denied");
  assert.equal((await said("つなぎ先の GAS に、持ち主の登録を受けつけました。10分以内に、GAS エディタで adoptShoqujiOwner を実行してね")).error, "claim");
  assert.equal((await said("うまくいきませんでした。")).error, "fail");
});

test("つなぐ先は script.google.com の …/exec だけ。ブラウザ（LINE の外）では何もしない", async () => {
  assert.equal(cleanGasUrl(GAS), GAS);
  assert.equal(cleanGasUrl(" " + GAS + " "), GAS);
  for (const bad of ["http://script.google.com/macros/s/AKfyTEST_123/exec", "https://evil.example/exec", `${GAS}?x=1`, "javascript:alert(1)", ""]) assert.equal(cleanGasUrl(bad), "");
  assert.equal(inLineApp("Mozilla/5.0 (iPhone) Line/14.0.0"), true);
  assert.equal(inLineApp("Mozilla/5.0 (iPhone) Safari/604.1"), false);
  globalThis.navigator ??= {};
  assert.equal(await startLineLog(GAS, { liffId: "" }), null, "LIFF ID がないとき");
  assert.equal(await startLineLog("", { liffId: "123-abc" }), null, "つなぎ先がないとき");
});

test("ボットの記録を出すとき：しょくじから送った記録・消した記録は出さない。食事の名前をそろえ、見るだけの印を付ける", () => {
  const local = [{ id: "mine1" }];
  const out = botLogsForView(
    [
      { logId: "L1", clientId: "mine1", date: "2026-10-24", meal: "朝", menu: "パン", kcal: 200 },
      { logId: "L2", clientId: "gone1", date: "2026-10-24", meal: "昼", menu: "そば", kcal: 400 },
      { logId: "L3", clientId: "", date: "2026-10-24", meal: "その他", menu: "チョコ", kcal: null, protein: 2 },
      { logId: "L4", date: "bad", meal: "夜", menu: "x" },
      { logId: "L5", date: "2026-10-24", meal: "夜", menu: "  " }
    ],
    local,
    ["gone1"]
  );
  assert.deepEqual(out, [{ id: "bot-L3", logId: "L3", date: "2026-10-24", meal: "間食", name: "チョコ", kcal: null, p: 2, f: null, c: null, bot: true }]);
  assert.equal(toBotMeal("間食"), "その他");
  assert.equal(fromBotMeal("その他"), "間食");
});

test("ID トークンは端末に残さない（W7）。つなぎ先の URL は形の合うものだけ残す。送った記録の id を覚える", () => {
  mem.clear();
  const s = store.load();
  s.gasUrl = GAS;
  const log = store.addLog(s, { date: "2026-10-24", meal: "朝", name: "パン", kcal: "200" });
  store.markSent(s, [log.id, "<bad>"]);
  store.save(s);
  const text = [...mem.values()].join("");
  assert.ok(!text.includes(TOKEN));
  const again = store.load();
  assert.equal(again.gasUrl, GAS);
  assert.deepEqual(again.sent, [log.id]);
  localStorage.setItem("shoquji:v1", JSON.stringify({ ...again, gasUrl: "https://evil.example/exec" }));
  assert.equal(store.load().gasUrl, "");
});

test("失敗の言葉は、やさしい言葉だけ（仕組みの言葉を出さない）", () => {
  for (const e of ["auth", "denied", "claim", "fail", "net"]) {
    const m = lineLogMessage(e);
    assert.ok(m.length > 5);
    assert.doesNotMatch(m, /error|LIFF|API|token/i);
  }
});

test("直す・消す・設定の呼び出しの形（自分の記録は clientId で。カロリーなしでもよい。MYメニューには触らない）", async () => {
  const seen = [];
  const c = makeClient(GAS, () => TOKEN, okFetch({ ok: true }, seen));
  await c.updateOwn({ id: "abc123", date: "2026-10-24", meal: "夜", name: "そば", kcal: null, p: null, f: null, c: null });
  assert.deepEqual(seen[0].body, { idToken: TOKEN, action: "updateMealLog", source: "shoquji", clientId: "abc123", allowPending: true, mealDate: "2026-10-24", meal: "夜", menu: "そば", kcal: null, protein: null, fat: null, carb: null, saveToMaster: false, sendLineSummary: false });
  await c.removeOwn("abc123");
  assert.deepEqual(seen[1].body, { idToken: TOKEN, action: "deleteMealLog", source: "shoquji", clientId: "abc123" });
  await c.removeBot("L9");
  assert.deepEqual(seen[2].body, { idToken: TOKEN, action: "deleteMealLog", source: "shoquji", logId: "L9" });
  await c.profile({ notify: true });
  assert.deepEqual(seen[3].body, { idToken: TOKEN, action: "updateProfile", source: "shoquji", notify: true });
  await c.state();
  assert.deepEqual(seen[4].body, { idToken: TOKEN, action: "getLiffAppState", source: "shoquji" });
});
