// まだくらぶボットに送っていない記録（電波がない・ログインしていない・つながる前に入れた分）
//   - 記録はいつも先に端末（localStorage の shoquji:v1）に残す。送れたら sent に id を足す（js/store.js の markSent）
//   - 送っていないものは、つながったとき・電波がもどったとき・次に開いたときに送る（js/botlink.js）
//   - 同じ記録を2回送らない：送っている途中の id は、もう一度送らない（ボットも同じ id は1回だけ入れる）
// 画面には文字だけを返す（saveNoteText）。DOM にはさわらない（テストは test/outbox.test.mjs）
import { addDays } from "./stats.js?v=202610291713";

export const UNSENT_DAYS = 7; // 送りなおすのは、ここ7日の記録まで

/** まだ送っていない、ここ7日の記録（today は YYYY-MM-DD） */
export function unsentLogs(state, today, days = UNSENT_DAYS) {
  const from = addDays(today, -(days - 1));
  const sent = new Set(state?.sent || []);
  return (state?.logs || []).filter((l) => l.date >= from && !sent.has(l.id));
}

/**
 * 送る係：send(logs) → Promise<返事>。送っている途中の記録は、もう一度は送らない
 * push(logs) → 返事（送るものがなければ { ok: true, none: true }）
 */
export function createOutbox(send) {
  const flying = new Set();
  async function push(logs) {
    const go = (logs || []).filter((l) => !flying.has(l.id));
    if (!go.length) return { ok: true, none: true };
    go.forEach((l) => flying.add(l.id));
    try {
      return await send(go);
    } catch {
      return { ok: false, error: "net" };
    } finally {
      go.forEach((l) => flying.delete(l.id));
    }
  }
  return { push, flying: (id) => flying.has(id) };
}

/** 電波がなさそうか（わからないときは「ある」） */
export const isOffline = (nav = typeof navigator !== "undefined" ? navigator : null) => !!nav && nav.onLine === false;

/**
 * 画面の小さな1行（出さないときは ""）
 * s：{ inLine（LINE 版か）, pending（まだ送っていない数）, loggedIn（LINE にログインしているか。わからなければ undefined） }
 */
export function saveNoteText(s) {
  const n = Math.max(0, Number(s?.pending) || 0);
  if (n) return `📮 ${n}件 まだ送っていません（つながったら送ります）`;
  if (s?.inLine && s.loggedIn === false) return "👤 ログインしていません。記録はこの端末に保存中";
  return "";
}

// 前につながったくらぶボットの URL を覚えておく場所（URL だけ。ID トークンは入れない）
export const BOT_SEEN_KEY = "shoquji:bot";
// つながったくらぶボットの URL を覚える（"" なら忘れる。残せない端末では何もしない）
export function rememberBot(url, storage = globalThis.localStorage) {
  try {
    if (url) storage.setItem(BOT_SEEN_KEY, url);
    else storage.removeItem(BOT_SEEN_KEY);
  } catch {
    // 残せなくても、つないでいるあいだは送れる
  }
}
// 覚えているくらぶボットの URL（なければ ""）
export function seenBot(storage = globalThis.localStorage) {
  try {
    return String(storage.getItem(BOT_SEEN_KEY) || "");
  } catch {
    return "";
  }
}
/**
 * つながっていなくても、くらぶボットに送る人とわかるか
 * - 自分で入れたつなぎ先（own）があるとき
 * - なければ、前につながったくらぶボットの URL が、いまも入っているとき（くらぶボットに「しょくじ」の機能があるとわかっている）
 */
export const botKnown = ({ own, qloveUrl, seen }) => !!(own || (qloveUrl && qloveUrl === seen));
