// くらぶボットとのつなぎ（LINE 版で、つないだときだけ。送る・読む・そろえるの中身は js/linelog.js）
//   - つなぐ：まず読んでみて、このボットを使っていない人なら何も出さずに端末の中だけ（asGuest）
//   - 送る：しょくじの記録をボットにも入れる（同じ id は何度送っても1回だけ）。まだ送っていない、ここ7日の分も
//   - 読む：ボットで入れた記録（60日分）を読み、端末に控える（開いてすぐ出すため。shoquji:bot）
//   - そろえる：しょくじの自分の記録とボットの行がずれていたら、あとから直したほうに合わせる（planSync）
//   - 消す：画面からは先に消し、「元に戻す」を押せるあいだは待ってから、ボットからも消す（js/removals.js）
// 画面の残り（記録・一覧など）とは、createBotLink で受けとる ctx でつなぐ
// app.js が読む（createBotLink を1回）
import { addDays, ymd } from "./stats.js?v=202610262100";
import { markSent, removeLog, updateLog } from "./store.js?v=202610262100";
import { botLogsForView, cleanGasUrl, inLineApp, lineLogMessage, planSync, startLineLog } from "./linelog.js?v=202610262100";
import { LINE_LOG } from "./line-config.js?v=202610262100";
import { resetProfile, readProfile } from "./bot-menu.js?v=202610262100";
import { cancelRemoval, queueRemoval, waitingOwnIds } from "./removals.js?v=202610262100";
import { $ } from "./dom.js?v=202610262100";

const BOT_KEY = "shoquji:bot"; // ボットで入れた記録の控え（LINE の中でつないだときだけ）
const BOT_DAYS = 60; // 読むのは、きょうから60日前まで

/**
 * ctx: { state() いまの記録, ui, link, render(), persist(), say(text, undo), cancelEdit(), startBotEdit(logId), changed()（送った・つながったときに、見出しのアイコンの印を描きなおす） }
 */
export function createBotLink(ctx) {
  const inLine = !!LINE_LOG.liffId && inLineApp(); // つなぎ先の欄は、LINE 版のときだけ出す
  // つなぐ先：自分で入れた URL。なければ、この LIFF のくらぶボット
  const gasTarget = () => ctx.state().gasUrl || cleanGasUrl(LINE_LOG.gasUrl);
  let client = null; // startLineLog の返事（つなげないときは null）
  let bot = loadBot();
  let lastRead = 0;
  let range = null; // ボットの記録を全部読めた期間 { from, to }
  let syncing = false;
  const hidden = new Set(); // 消すのを待っているボットの記録の logId（画面からは先に消す）

  function loadBot() {
    if (!inLine || !gasTarget()) return [];
    try {
      const raw = JSON.parse(localStorage.getItem(BOT_KEY) || "null");
      return raw && raw.gasUrl === gasTarget() && Array.isArray(raw.logs) ? raw.logs : [];
    } catch {
      return [];
    }
  }

  // 画面に出す中身：この端末の記録＋ボットで入れた記録（しょくじから送ったもの・消したものは除く）。ボットの記録は端末には足さない
  function view() {
    const state = ctx.state();
    if (!bot.length) return state;
    const shown = bot.filter((b) => !hidden.has(String(b.logId)));
    return { ...state, logs: [...state.logs, ...botLogsForView(shown, state.logs, state.deleted)] };
  }

  // くらぶボットとつながっているときだけ出すもの（記録の置き場所の説明・つながっている説明・よく記録するもの・20時のお知らせ）
  function showConnected(on) {
    ["whereNote", "lineLogNote", "quickFold", "botNotifyRow"].forEach((id) => ($(id).hidden = !on));
    $("lineIntro").hidden = on;
  }

  // このボットをまだ使っていない人（公開ページから LINE で開いた人など）：知らせを出さず、つながない（端末の中だけ）
  function asGuest(res) {
    if (!res || res.error !== "guest") return false;
    client = null;
    bot = [];
    resetProfile();
    showConnected(false);
    ctx.render();
    return true;
  }

  // 記録をボットにも入れる（同じ id は何度送っても1回だけ入る）。うまくいかなければ「もう一度」
  async function send(logs, { quiet = false } = {}) {
    if (!client || !logs.length) return;
    const res = await client.record(logs);
    if (asGuest(res)) return;
    if (res.ok) {
      markSent(ctx.state(), logs.map((l) => l.id));
      ctx.persist();
      ctx.changed?.();
      if (!quiet && res.added?.length) ctx.say(`🤖 くらぶボットにも入れました`);
      return;
    }
    if ((res.error === "net" || res.error === "fail") && window.LineShareUI?.toast) {
      window.LineShareUI.toast(lineLogMessage(res.error), { actionLabel: "もう一度", onAction: () => send(logs), ms: 8000 });
    } else {
      ctx.say(lineLogMessage(res.error));
    }
  }

  // しょくじで記録した・直した記録をボットにも（送ってあれば直す、まだなら入れる）
  function sendSaved(log, { edited = false } = {}) {
    if (!client) return;
    if (edited && ctx.state().sent.includes(log.id)) client.updateOwn(log).then((res) => !res.ok && ctx.say(lineLogMessage(res.error)));
    else send([log], { quiet: true });
  }

  // まだボットに入れていない、ここ7日の記録（電波がなかった・ログインしていなかった・つながる前に入れた分）
  function unsent() {
    const state = ctx.state();
    const from = addDays(ymd(), -6);
    const sent = new Set(state.sent);
    return state.logs.filter((l) => l.date >= from && !sent.has(l.id));
  }

  // まだボットに入れていない、ここ7日の記録を入れる（つながったとき・電波がもどったとき）
  function sendUnsent() {
    return send(unsent().slice(0, 30), { quiet: true });
  }

  // まだボットに送っていない記録の数（見出しの右のアイコンの印。LINE 版でボットにつなぐ人だけ）
  function pending() {
    return inLine && gasTarget() ? unsent().length : 0;
  }

  // 電波がもどったとき・「いま送る」：つながっていれば送って読みなおし、まだならつなぎなおす（つなぐと送る）
  async function retry() {
    if (!client) return connect();
    await sendUnsent();
    await read(true);
    ctx.changed?.();
  }

  // ボットで入れた記録を読む（つながったとき・戻ってきたとき。1分に1回まで）
  async function read(force = false, given = null) {
    if (!client || (!force && Date.now() - lastRead < 60000)) return;
    lastRead = Date.now();
    const res = given || (await client.list(addDays(ymd(), -(BOT_DAYS - 1)), ymd()));
    if (asGuest(res)) return;
    if (!res.ok) {
      if (res.error !== "net") ctx.say(lineLogMessage(res.error));
      return;
    }
    bot = Array.isArray(res.logs) ? res.logs : [];
    // 読んだ期間（全部読めたときだけ。この中でだけ、ないものを「ほかで消された」とみなす）
    range = res.from && res.to && res.complete === true ? { from: res.from, to: res.to } : null;
    try {
      localStorage.setItem(BOT_KEY, JSON.stringify({ gasUrl: gasTarget(), logs: bot }));
    } catch {
      // 残せなくても、開いているあいだは出る
    }
    ctx.render();
    sync();
  }

  // しょくじの自分の記録とボットの行がずれていたら、そろえる（画面の合計とボットのカードの合計を同じに）。
  // 消した記録はボットからも消し、中身がちがえば、あとから直したほうに合わせる（js/linelog.js の planSync）
  async function sync() {
    if (!client || syncing) return;
    const state = ctx.state();
    const plan = planSync(bot, state.logs, state.deleted, waitingOwnIds(), { sent: state.sent, range });
    if (!plan.push.length && !plan.pull.length && !plan.remove.length && !plan.drop.length) return;
    syncing = true;
    // ほかの端末（LINE 版）で消された自分の記録：手元からも消す（消した印も残すので、あとで生き返らない）
    plan.drop.forEach((id) => removeLog(state, id));
    if (plan.drop.length) ctx.persist();
    // ボットのほうが新しい（トークでカロリーを入れたなど）：しょくじの記録を直す（ボットには送りなおさない）
    plan.pull.forEach(({ id, entry }) => updateLog(state, id, entry));
    if (plan.pull.length) ctx.persist();
    let changed = false;
    for (const l of plan.push) changed = (await client.updateOwn(l)).ok || changed;
    for (const id of plan.remove) changed = (await client.removeOwn(id)).ok || changed;
    syncing = false;
    ctx.render();
    if (changed) read(true);
  }

  // しょくじで消した自分の記録：ボットに送ってあれば、ボットからも消す
  function removeOwnLater(log) {
    if (!client || !ctx.state().sent.includes(log.id)) return;
    queueRemoval(`own:${log.id}`, async (keepalive) => {
      const res = await client.removeOwn(log.id, keepalive);
      if (!res.ok && !keepalive) ctx.say(lineLogMessage(res.error));
    });
  }

  // ボットの記録を消す（画面からは先に消し、「元に戻す」を押せるあいだは待つ）
  function removeBot(logId) {
    const id = String(logId);
    const b = find(id);
    if (!b || !client) return;
    if (ctx.ui.botEdit === id) ctx.cancelEdit();
    hidden.add(id);
    ctx.render();
    queueRemoval(`bot:${id}`, async (keepalive) => {
      const res = await client.removeBot(id, keepalive);
      if (res.ok) {
        bot = bot.filter((x) => String(x.logId) !== id);
        hidden.delete(id);
      } else if (!keepalive) {
        hidden.delete(id);
        ctx.say(lineLogMessage(res.error));
      }
      ctx.render();
    });
    ctx.say(`🗑 「${b.menu}」を消しました（くらぶボットからも）`, () => {
      cancelRemoval(`bot:${id}`);
      hidden.delete(id);
      ctx.render();
    });
  }

  function find(logId) {
    return bot.find((x) => String(x.logId) === String(logId));
  }

  // つなぐ（つなぎ先を入れなおしたときも、ここからやりなおす）
  function connect() {
    const had = !!client;
    client = null;
    return startLineLog(gasTarget()).then(async (next) => {
      // つなぎ先がある人が、LINE のアプリ内のブラウザ（LIFF ではない）で開いたときは、開きなおしを出す
      $("reopenInLiff").hidden = window.QBotLink ? window.QBotLink.reopenHidden({ client: next, url: gasTarget() }) : true;
      showConnected(false);
      if (!next) return had && ctx.render();
      client = next;
      // まず読んでみて、このボットを使っていない人なら、何も出さずに端末の中だけで使う（つながった表示も出さない）
      const first = await next.list(addDays(ymd(), -(BOT_DAYS - 1)), ymd());
      if (asGuest(first)) return;
      showConnected(true);
      ctx.render();
      ctx.changed?.();
      await read(true, first);
      await sendUnsent();
      await readProfile();
      if (ctx.link.logId && !ctx.link.used) {
        ctx.link.used = true;
        ctx.startBotEdit(ctx.link.logId);
      }
    });
  }

  // つなぎ先を変えたとき：前のボットの記録は出さない
  function forget() {
    bot = [];
  }

  return { inLine, client: () => client, view, find, send, sendSaved, read, removeOwnLater, removeBot, connect, forget, pending, retry };
}
