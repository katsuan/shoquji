// しょくじ（ShoQuji）：画面の操作。記録はこの端末の中だけ（js/store.js）、計算は js/stats.js
import { MEALS, addLog, exportJson, importJson, load, markSent, num, removeLog, reset, restoreLog, save, updateLog } from "./js/store.js?v=202610250010";
import { addDays, fmt, label, logsOf, mealNow, menus, streak, totals, week, ymd } from "./js/stats.js?v=202610250010";
import { botLogsForView, cleanGasUrl, fromBotMeal, inLineApp, lineLogMessage, planSync, startLineLog, toBotMeal } from "./js/linelog.js?v=202610250010";
import { LINE_LOG, OPEN_URL } from "./js/line-config.js?v=202610250010";
import { drawQuickMenu, LAYOUT as RICH_LAYOUT } from "./js/meal-richmenu.js?v=202610250010";

const $ = (id) => document.getElementById(id);
const PAGE_URL = "https://katsuan.github.io/shoquji/";
const CARD_COLOR = "#EC8A16"; // ロゴの玉子焼きの黄色

let state = load();
const ui = {
  date: ymd(), // 記録する日・見る日
  meal: mealNow(),
  editing: null, // 直している記録の id
  botEdit: null, // 直している、食事記録ボットの記録の logId（LINE の中でつないだとき）
  masterEdit: null, // 保存する MYメニュー { key }（ボットのカードの「MYメニューを直す」から）
  justAdded: null // 記録したばかりの id（一覧で少し光らせる）
};

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NUTRI = ["kcal", "p", "f", "c"];

function persist() {
  if (!save(state)) say("この端末に残せませんでした（プライベートブラウズでは、閉じると消えます）");
}

// ---- 食事記録ボット（LINE の中で開いて、つないだときだけ。js/linelog.js） ----
let lineLog = null; // startLineLog の返事（つなげないときは null）
let profile = null; // ボットの { user, quickMenus, popularMenus, menus, quickRichMenu }（つないだあと、開いたときに読む）
let pins = null; // 並べかえ中の固定（MYメニューの masterKey）。null のあいだは保存してある並び
const dn = (m) => String(m.displayName || [m.menu || m.name, m.flavor, m.unit].filter(Boolean).join(" ")).trim(); // MYメニューの名前（種類・量つき）
const inLine = !!LINE_LOG.liffId && inLineApp(); // つなぎ先の欄は、LINE の中で開いたときだけ出す
const BOT_KEY = "shoquji:bot"; // ボットで入れた記録の控え（開いてすぐ出すため。LINE の中でつないだときだけ）
const BOT_DAYS = 60; // 読むのは、きょうから60日前まで
// つなぐ先：自分で入れた URL。なければ、この LIFF の食事記録ボット
const gasTarget = () => state.gasUrl || cleanGasUrl(LINE_LOG.gasUrl);
let bot = loadBot();
let lastRead = 0;

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
  if (!bot.length) return state;
  const shown = bot.filter((b) => !hiddenBot.has(String(b.logId)));
  return { ...state, logs: [...state.logs, ...botLogsForView(shown, state.logs, state.deleted)] };
}

// ---- 消すのは「元に戻す」を押せるあいだ待ってから、ボットにも送る（閉じる・切りかえるときは、すぐ送る） ----
const UNDO_MS = 6500;
const pendingRemovals = new Map(); // key → { run, timer }
const hiddenBot = new Set(); // 消すのを待っているボットの記録の logId（画面からは先に消す）
function queueRemoval(key, run) {
  cancelRemoval(key);
  pendingRemovals.set(key, { run, timer: setTimeout(() => flushRemoval(key), UNDO_MS) });
}
function cancelRemoval(key) {
  const p = pendingRemovals.get(key);
  if (p) clearTimeout(p.timer);
  pendingRemovals.delete(key);
}
async function flushRemoval(key, keepalive = false) {
  const p = pendingRemovals.get(key);
  if (!p) return;
  cancelRemoval(key);
  await p.run(keepalive);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") [...pendingRemovals.keys()].forEach((key) => flushRemoval(key, true));
});

// しょくじで消した自分の記録：ボットに送ってあれば、ボットからも消す
function removeOwnLater(log) {
  if (!lineLog || !state.sent.includes(log.id)) return;
  queueRemoval(`own:${log.id}`, async (keepalive) => {
    const res = await lineLog.removeOwn(log.id, keepalive);
    if (!res.ok && !keepalive) say(lineLogMessage(res.error));
  });
}

// ボットの記録を消す（画面からは先に消し、「元に戻す」を押せるあいだは待つ）
function removeBot(logId) {
  const b = bot.find((x) => String(x.logId) === String(logId));
  if (!b || !lineLog) return;
  if (ui.botEdit === String(logId)) cancelEdit();
  hiddenBot.add(String(logId));
  render();
  queueRemoval(`bot:${logId}`, async (keepalive) => {
    const res = await lineLog.removeBot(String(logId), keepalive);
    if (res.ok) {
      bot = bot.filter((x) => String(x.logId) !== String(logId));
      hiddenBot.delete(String(logId));
    } else if (!keepalive) {
      hiddenBot.delete(String(logId));
      say(lineLogMessage(res.error));
    }
    render();
  });
  say(`🗑 「${b.menu}」を消しました（食事記録ボットからも）`, () => {
    cancelRemoval(`bot:${logId}`);
    hiddenBot.delete(String(logId));
    render();
  });
}

// このボットをまだ使っていない人（公開ページから LINE で開いた人など）：知らせを出さず、つながない（端末の中だけ）
function asGuest(res) {
  if (!res || res.error !== "guest") return false;
  lineLog = null;
  bot = [];
  profile = null;
  ["whereNote", "lineLogNote", "quickFold", "botNotifyRow"].forEach((id) => ($(id).hidden = true));
  $("lineIntro").hidden = false;
  render();
  return true;
}

// 記録をボットにも入れる（同じ id は何度送っても1回だけ入る）。うまくいかなければ「もう一度」
async function sendToBot(logs, { quiet = false } = {}) {
  if (!lineLog || !logs.length) return;
  const res = await lineLog.record(logs);
  if (asGuest(res)) return;
  if (res.ok) {
    markSent(state, logs.map((l) => l.id));
    persist();
    if (!quiet && res.added?.length) say(`💬 食事記録ボットにも入れました`);
    return;
  }
  if ((res.error === "net" || res.error === "fail") && window.LineShareUI?.toast) {
    window.LineShareUI.toast(lineLogMessage(res.error), { actionLabel: "もう一度", onAction: () => sendToBot(logs), ms: 8000 });
  } else {
    say(lineLogMessage(res.error));
  }
}

// まだボットに入れていない、ここ7日の記録を入れる（つながったとき。電波がなかったときの分など）
function sendUnsent() {
  const from = addDays(ymd(), -6);
  const sent = new Set(state.sent);
  const todo = state.logs.filter((l) => l.date >= from && !sent.has(l.id)).slice(0, 30);
  return sendToBot(todo, { quiet: true });
}

// ボットで入れた記録を読む（つながったとき・戻ってきたとき。1分に1回まで）
async function readBot(force = false, given = null) {
  if (!lineLog || (!force && Date.now() - lastRead < 60000)) return;
  lastRead = Date.now();
  const res = given || (await lineLog.list(addDays(ymd(), -(BOT_DAYS - 1)), ymd()));
  if (asGuest(res)) return;
  if (!res.ok) {
    if (res.error !== "net") say(lineLogMessage(res.error));
    return;
  }
  bot = Array.isArray(res.logs) ? res.logs : [];
  try {
    localStorage.setItem(BOT_KEY, JSON.stringify({ gasUrl: gasTarget(), logs: bot }));
  } catch {
    // 残せなくても、開いているあいだは出る
  }
  render();
  syncWithBot();
}

// しょくじの自分の記録とボットの行がずれていたら、そろえる（画面の合計とボットのカードの合計を同じに）。
// 消した記録はボットからも消し、中身がちがえば、あとから直したほうに合わせる（js/linelog.js の planSync）
let syncing = false;
async function syncWithBot() {
  if (!lineLog || syncing) return;
  const waiting = new Set([...pendingRemovals.keys()].filter((k) => k.startsWith("own:")).map((k) => k.slice(4)));
  const plan = planSync(bot, state.logs, state.deleted, waiting);
  if (!plan.push.length && !plan.pull.length && !plan.remove.length) return;
  syncing = true;
  // ボットのほうが新しい（トークでカロリーを入れたなど）：しょくじの記録を直す（ボットには送りなおさない）
  plan.pull.forEach(({ id, entry }) => updateLog(state, id, entry));
  if (plan.pull.length) persist();
  let changed = false;
  for (const l of plan.push) changed = (await lineLog.updateOwn(l)).ok || changed;
  for (const id of plan.remove) changed = (await lineLog.removeOwn(id)).ok || changed;
  syncing = false;
  render();
  if (changed) readBot(true);
}

// つなぎ先を入れなおしたときも、ここからやりなおす
function connectLineLog() {
  const had = !!lineLog;
  lineLog = null;
  return startLineLog(gasTarget()).then(async (client) => {
    // つなぎ先がある人が、LINE のアプリ内のブラウザ（LIFF ではない）で開いたときは、開きなおしを出す
    $("reopenInLiff").hidden = !!client || !gasTarget() || !inLineApp();
    $("lineLogNote").hidden = !client;
    $("lineIntro").hidden = !!client;
    $("quickFold").hidden = !client;
    $("botNotifyRow").hidden = !client;
    if (!client) {
      $("whereNote").hidden = true;
      return had && render();
    }
    lineLog = client;
    // まず読んでみて、このボットを使っていない人なら、何も出さずに端末の中だけで使う
    const first = await client.list(addDays(ymd(), -(BOT_DAYS - 1)), ymd());
    if (asGuest(first)) return;
    $("whereNote").innerHTML = "📱 LINE で開いたしょくじの記録は、Safari などのブラウザで開いたときとは<b>別</b>です。<br>記録すると、食事記録ボットにも入ります。"; // qcheck-ok: W1 決まった文字だけ
    $("whereNote").hidden = false;
    render();
    await readBot(true, first);
    await sendUnsent();
    await readProfile();
    if (link.logId && !link.used) {
      link.used = true;
      startBotEdit(link.logId);
    }
  });
}

// 知らせは Q キットのトースト（下に数秒）。取り消せるものは「元に戻す」を付ける。読めないときは下の文字で
function say(text, undo) {
  if (window.LineShareUI?.toast) {
    window.LineShareUI.toast(text, undo ? { actionLabel: "元に戻す", onAction: undo } : {});
    return;
  }
  $("status").textContent = text;
  clearTimeout(say.timer);
  if (text) say.timer = setTimeout(() => ($("status").textContent = ""), 3500);
}

// ---- 日付 ----
function dayOffset() {
  const today = ymd();
  for (let n = 0; n >= -1; n--) if (addDays(today, n) === ui.date) return n;
  return null;
}

function renderDays() {
  const off = dayOffset();
  document.querySelectorAll("[data-day]").forEach((b) => b.classList.toggle("is-active", Number(b.dataset.day) === off));
  const pick = document.querySelector(".date-pick");
  pick.classList.toggle("is-active", off === null);
  $("pickLabel").textContent = off === null ? `📅 ${label(ui.date)}` : "📅 日付";
  $("datePick").value = ui.date;
  $("datePick").max = ymd();
}

function setDate(date) {
  ui.date = date;
  cancelEdit();
  render();
}

document.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => setDate(addDays(ymd(), Number(b.dataset.day)))));
$("datePick").addEventListener("change", (e) => e.target.value && setDate(e.target.value));

// ---- 朝・昼・夜・間食 ----
function renderMeals() {
  const box = document.querySelector(".meals");
  box.innerHTML = MEALS.map((m) => `<button class="ls-chip" type="button" role="radio" aria-checked="${m === ui.meal}" aria-pressed="${m === ui.meal}" data-meal="${m}">${m}</button>`).join("");
}
document.querySelector(".meals").addEventListener("click", (e) => {
  const b = e.target.closest("[data-meal]");
  if (!b) return;
  ui.meal = b.dataset.meal;
  renderMeals();
});

// ---- 食べたもの・よく食べるもの ----
// 食べたものの候補：しょくじ・ボットの記録で食べたもの → つないでいるときは MYメニュー（ボットの栄養の表）も
function allMenus() {
  const base = menus(view());
  if (!profile?.menus?.length) return base;
  const byName = new Map(base.map((m) => [m.name, m]));
  profile.menus.forEach((m) => {
    const name = dn(m);
    const nums = { kcal: m.kcal ?? null, p: m.protein ?? null, f: m.fat ?? null, c: m.carb ?? null };
    const had = byName.get(name);
    if (had) NUTRI.forEach((k) => had[k] == null && nums[k] != null && (had[k] = nums[k]));
    else {
      const item = { name, count: 0, ...nums };
      byName.set(name, item);
      base.push(item);
    }
  });
  return base;
}

function renderSuggest() {
  const q = $("name").value.trim();
  const list = allMenus()
    .filter((m) => !q || (m.name.includes(q) && m.name !== q))
    .slice(0, q ? 6 : 8);
  $("suggest").innerHTML = list
    .map((m, i) => `<button class="ls-chip is-small pick" type="button" data-i="${i}">${esc(m.name)}${m.kcal != null ? `<small>${fmt(m.kcal)}kcal</small>` : ""}</button>`)
    .join("");
  $("suggest").onclick = (e) => {
    const b = e.target.closest("[data-i]");
    if (b) fillMenu(list[Number(b.dataset.i)]);
  };
}

// 前に食べたものを入れる（名前と、最後に入れたカロリー・PFC）
function fillMenu(m) {
  $("name").value = m.name;
  hideNameError();
  NUTRI.forEach((k) => ($(k).value = m[k] ?? ""));
  if (NUTRI.some((k) => m[k] != null)) $("nutri").open = true;
  renderSuggest();
}

function hideKcalError() {
  $("kcalError").hidden = true;
  $("kcal").removeAttribute("aria-invalid");
}
$("kcal").addEventListener("input", hideKcalError);

function hideNameError() {
  $("nameError").hidden = true;
  $("name").removeAttribute("aria-invalid");
}

$("name").addEventListener("input", () => {
  if ($("name").value.trim()) hideNameError();
  renderSuggest();
});
// 名前を入れ終えたとき、同じ名前を前に食べていれば栄養も入れる（空の欄だけ）
$("name").addEventListener("change", () => {
  const m = allMenus().find((x) => x.name === $("name").value.trim());
  if (!m) return;
  NUTRI.forEach((k) => {
    if ($(k).value === "" && m[k] != null) $(k).value = m[k];
  });
});

// ---- 記録する・直す ----
function readForm() {
  return { date: ui.date, meal: ui.meal, name: $("name").value, ...Object.fromEntries(NUTRI.map((k) => [k, $(k).value])) };
}

function clearForm() {
  $("name").value = "";
  hideNameError();
  hideKcalError();
  NUTRI.forEach((k) => ($(k).value = ""));
  renderSuggest();
}

let savedAt = 0; // 記録した時刻（すぐの二度押しで「入れてね」を出さない）
$("saveBtn").addEventListener("click", () => {
  const entry = readForm();
  if (!entry.name.trim() && Date.now() - savedAt < 1000) return;
  // 足りないときは、その欄のすぐ下に赤い文字で
  if (!entry.name.trim()) {
    $("nameError").hidden = false;
    $("name").setAttribute("aria-invalid", "true");
    $("name").focus();
    return;
  }
  if (ui.botEdit || ui.masterEdit) return saveRemote(entry);
  if (ui.editing) {
    const edited = updateLog(state, ui.editing, entry);
    say(`✏️ 「${entry.name.trim()}」を直しました`);
    ui.editing = null;
    // ボットにも：送ってあれば直す、まだなら送る
    if (edited && lineLog) {
      if (state.sent.includes(edited.id)) lineLog.updateOwn(edited).then((res) => !res.ok && say(lineLogMessage(res.error)));
      else sendToBot([edited], { quiet: true });
    }
  } else {
    const log = addLog(state, entry);
    ui.justAdded = log.id;
    // 季節の絵文字をときどき（Q キットの season.js。読めていなければ付けない）
    const done = `🍚 ${label(ui.date)} の${ui.meal}に「${entry.name.trim()}」を記録しました ↓`;
    say(window.QSeason ? QSeason.decorate(done) : done);
    sendToBot([log], { quiet: true });
  }
  savedAt = Date.now();
  persist();
  clearForm();
  render();
});

// ボットの記録を直す・MYメニューを保存する（端末の記録はふやさない）。カロリーは要る
let savingRemote = false;
async function saveRemote(entry) {
  if (savingRemote) return;
  if (!lineLog) return say("ボットの記録・MYメニューは、LINE の中で開いたときに直せます");
  const e = { ...entry, name: entry.name.trim(), kcal: num(entry.kcal), p: num(entry.p), f: num(entry.f), c: num(entry.c) };
  if (e.kcal == null) {
    $("nutri").open = true;
    $("kcalError").hidden = false;
    $("kcal").setAttribute("aria-invalid", "true");
    $("kcal").focus();
    return;
  }
  savingRemote = true;
  $("saveBtn").disabled = true;
  $("saveBtn").textContent = "保存中…";
  const res = ui.botEdit ? await lineLog.update(ui.botEdit, e) : await lineLog.saveMaster(ui.masterEdit.key, e, ui.masterEdit.keep);
  savingRemote = false;
  $("saveBtn").disabled = false;
  if (!res.ok) {
    render();
    return say(lineLogMessage(res.error));
  }
  if (ui.botEdit) {
    // 画面のボットの記録も、返事を待たずに直す（次に読んだときにそろう）
    const b = bot.find((x) => String(x.logId) === ui.botEdit);
    if (b) Object.assign(b, { date: e.date, meal: toBotMeal(e.meal), menu: e.name, kcal: e.kcal, protein: e.p, fat: e.f, carb: e.c });
    say(`✏️ 「${e.name}」を直しました（食事記録ボットにも）`);
  } else {
    // 画面の MYメニューも、返事を待たずに直す（次に開いたときにそろう）
    const m = profile?.menus?.find((x) => x.masterKey && x.masterKey === ui.masterEdit.key);
    if (m) Object.assign(m, { menu: e.name, kcal: e.kcal, protein: e.p, fat: e.f, carb: e.c });
    const saved = `📒 MYメニューの「${e.name}」を保存しました`;
    say(`${window.QSeason ? window.QSeason.decorate(saved) : saved}。次からトークで名前を送るだけで記録できます`);
  }
  savedAt = Date.now();
  ui.botEdit = null;
  ui.masterEdit = null;
  clearForm();
  render();
  readBot(true);
}

function fillEntry(e) {
  $("name").value = e.name || "";
  hideNameError();
  NUTRI.forEach((k) => ($(k).value = e[k] ?? ""));
  $("nutri").open = NUTRI.some((k) => e[k] != null);
}

// MYメニューを入力欄に開いて直す（「📌 よく記録するもの・MYメニュー」から）
function startMasterEdit(key) {
  const m = byKey().get(key);
  if (!m) return;
  ui.editing = null;
  ui.botEdit = null;
  ui.masterEdit = { key, keep: { flavor: m.flavor, unit: m.unit, note: m.note, salt: m.salt, fiber: m.fiber } };
  // 名前の欄は、種類・量をのぞいた名前（種類・量・メモは、そのまま残す）
  fillEntry({ name: m.menu || dn(m), kcal: m.kcal, p: m.protein, f: m.fat, c: m.carb });
  render();
  $("formTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ボットの記録を、入力欄に開く（ボットのカードの「画面で詳しく」・一覧の「ボット」の記録を押したとき）
function startBotEdit(logId) {
  const b = bot.find((x) => String(x.logId) === String(logId));
  if (!b) return say("その記録は見つかりませんでした（消したかもしれません）");
  ui.editing = null;
  ui.masterEdit = null;
  ui.botEdit = String(b.logId);
  if (b.date) ui.date = b.date;
  ui.meal = fromBotMeal(b.meal);
  fillEntry({ name: b.menu, kcal: b.kcal, p: b.protein, f: b.fat, c: b.carb });
  render();
  $("formTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  if (b.kcal == null) {
    $("nutri").open = true;
    setTimeout(() => $("kcal").focus(), 350);
  }
}

function startEdit(id) {
  const log = state.logs.find((l) => l.id === id);
  if (!log) return;
  ui.editing = id;
  ui.meal = log.meal;
  $("name").value = log.name;
  hideNameError();
  NUTRI.forEach((k) => ($(k).value = log[k] ?? ""));
  $("nutri").open = NUTRI.some((k) => log[k] != null);
  render();
  $("formTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEdit() {
  if (!ui.editing && !ui.botEdit && !ui.masterEdit) return;
  ui.editing = null;
  ui.botEdit = null;
  ui.masterEdit = null;
  clearForm();
}
$("cancelEdit").addEventListener("click", () => {
  cancelEdit();
  render();
});

// ---- この日のしょくじ ----
function pct(v, goal) {
  return goal > 0 ? Math.min(100, Math.round((v / goal) * 100)) : 0;
}

// 合計カロリーと目標のバー、PFC
function totalsHtml(logs, t, g) {
  const missing = t.count - t.withKcal;
  // PFC は、入れた品がある日だけ出す（入れていないのに「0 g」と出ると、食べていないように見えるため）
  const hasPfc = logs.some((l) => l.p != null || l.f != null || l.c != null);
  const pfc = [["p", "たんぱく質"], ["f", "脂質"], ["c", "炭水化物"]]
    .map(([k, name]) => `<div class="${k}">${name}<b>${fmt(t[k])}<small> / ${fmt(g[k])}g</small></b><span class="bar"><i style="width:${pct(t[k], g[k])}%"></i></span></div>`)
    .join("");
  return `
      <div class="kcal-line"><b>${fmt(t.kcal)}<small>kcal</small></b><span>目標 ${fmt(g.kcal)} kcal（${pct(t.kcal, g.kcal)}%）</span></div>
      <div class="bar${t.kcal > g.kcal ? " over" : ""}"><i style="width:${pct(t.kcal, g.kcal)}%"></i></div>
      ${hasPfc ? `<div class="pfc">
        ${pfc}
      </div>` : ""}
      ${missing ? `<p class="note">※ カロリーを入れていないものが ${missing} 件あります（合計に入っていません）</p>` : ""}`;
}

// 食事ごとの一覧（名前を押すと直す、✕ で消す）
function itemHtml(l) {
  // ボットで入れた記録：消すのはトークで。直すのは、つないでいるときだけ
  if (l.bot) {
    // LINE の中でつないでいるときは、押すと直せる（ボットの記録を直す）
    const name = lineLog
      ? `<button class="name" type="button" data-bot-edit="${esc(l.logId)}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>`
      : `<span class="bot-name">${esc(l.name)}</span>`;
    return `<div class="item is-bot${l.logId === ui.botEdit ? " is-editing" : ""}">
            ${name}
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <span class="bot-tag" title="食事記録ボットで入れた記録">ボット</span>
            ${lineLog ? `<button class="del" type="button" data-bot-del="${esc(l.logId)}" aria-label="${esc(l.name)} を消す">✕</button>` : ""}
          </div>`;
  }
  return `<div class="item${l.id === ui.editing ? " is-editing" : ""}${l.id === ui.justAdded ? " is-new" : ""}">
            <button class="name" type="button" data-edit="${esc(l.id)}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <button class="del" type="button" data-del="${esc(l.id)}" aria-label="${esc(l.name)} を消す">✕</button>
          </div>`;
}

function dayListHtml(logs) {
  return MEALS.map((meal) => {
    const items = logs.filter((l) => l.meal === meal);
    if (!items.length) return "";
    return `<div class="meal-group"><span class="meal-tag">${meal}</span><div class="items">${items.map(itemHtml).join("")}</div></div>`;
  }).join("");
}

let emptyEmoji = null; // 記録がない日のあいさつに付ける季節の絵文字（"" は付けない）
function renderDay() {
  const logs = logsOf(view(), ui.date);
  const t = totals(logs);
  const off = dayOffset();
  $("dayHeading").textContent = off === 0 ? "きょうのしょくじ" : off === -1 ? "きのうのしょくじ" : `${label(ui.date)}のしょくじ`;

  if (!logs.length) {
    $("totals").innerHTML = "";
    // 季節の絵文字をときどき（Q キットの season.js が読めてから1回だけ決めて、描きなおしても変えない）
    if (emptyEmoji === null && window.QSeason) emptyEmoji = window.QSeason.maybe();
    $("dayList").innerHTML = `<div class="ls-empty"><span class="ls-empty-icon" aria-hidden="true">🍙</span>まだ記録がありません。上で食べたものを入れてみましょう${emptyEmoji ? ` ${emptyEmoji}` : ""}</div>`;
  } else {
    $("totals").innerHTML = totalsHtml(logs, t, state.targets);
    $("dayList").innerHTML = dayListHtml(logs);
  }
  ui.justAdded = null;
  // LINE で送る：記録があるときだけ出す。記録用の文字をオンにしていれば、そのことを小さく
  $("sendArea").hidden = !logs.length;
  $("sendTextNote").hidden = !state.sendText;
  $("sendBtn").href = logs.length ? cardUrl(ui.date, logs, t) : "#";
}

$("dayList").addEventListener("click", (e) => {
  const botEdit = e.target.closest("[data-bot-edit]");
  if (botEdit) return startBotEdit(botEdit.dataset.botEdit);
  const botDel = e.target.closest("[data-bot-del]");
  if (botDel) return removeBot(botDel.dataset.botDel);
  const edit = e.target.closest("[data-edit]");
  if (edit) return startEdit(edit.dataset.edit);
  const del = e.target.closest("[data-del]");
  if (!del) return;
  const log = state.logs.find((l) => l.id === del.dataset.del);
  if (!log) return;
  // すぐ消して、トーストの「元に戻す」で戻せるようにする（Q のツール共通。確かめのダイアログは出さない）
  removeLog(state, log.id);
  if (ui.editing === log.id) cancelEdit();
  persist();
  render();
  removeOwnLater(log);
  say(`🗑 「${log.name}」を消しました`, () => {
    // もうボットから消してしまっていたら（閉じかけて送ったなど）、もう一度入れる
    const already = !pendingRemovals.has(`own:${log.id}`);
    cancelRemoval(`own:${log.id}`);
    restoreLog(state, log);
    persist();
    render();
    if (already && lineLog) sendToBot([log], { quiet: true });
  });
});

// おくるんのお知らせカード（line-share の shared/oqrn.js）。中身は食事ごとの名前と合計
function cardUrl(date, logs, t) {
  const lines = MEALS.map((meal) => {
    const names = logs.filter((l) => l.meal === meal).map((l) => l.name);
    return names.length ? `${meal}：${names.join("、")}` : "";
  }).filter(Boolean);
  if (t.withKcal) lines.push("", `P ${fmt(t.p)}g ・ F ${fmt(t.f)}g ・ C ${fmt(t.c)}g`);
  const params = new URLSearchParams({
    headerTitle: "🍚 しょくじの記録",
    date: label(date),
    showDate: "true",
    title: t.withKcal ? `合計 ${fmt(t.kcal)} kcal` : `${logs.length} 品`,
    detail: lines.join("\n").slice(0, 300),
    theme: "custom",
    customColor: CARD_COLOR,
    showAction: "true",
    actionLabel: "🍚 しょくじで記録する",
    actionUrl: PAGE_URL,
    from: "shoquji"
  });
  if (state.sendText) params.set("sendText", recordText(date, logs));
  return window.OQRN ? window.OQRN.cardUrl(params) : "#";
}

// 記録用の文字（食事記録ボットが読む形。line-meal-project の 3_usecase.shoquji.gs）
//   #しょくじ 2026/10/22
//   朝 トースト 250kcal P8 F6 C40
function recordText(date, logs) {
  const lines = logs.map((l) => {
    const nums = [l.kcal != null ? `${l.kcal}kcal` : "", l.p != null ? `P${l.p}` : "", l.f != null ? `F${l.f}` : "", l.c != null ? `C${l.c}` : ""].filter(Boolean);
    return [l.meal, l.name.replace(/\s+/g, " "), ...nums].join(" ");
  });
  return [`#しょくじ ${date.replace(/-/g, "/")}`, ...lines].join("\n");
}

$("sendTextToggle").addEventListener("change", (e) => {
  state.sendText = e.target.checked;
  persist();
  render();
});

// ---- ふりかえり ----
function renderLookback() {
  const today = ymd();
  const all = view();
  const n = streak(all, today);
  $("streak").innerHTML = n ? `🔥 <b>${n}</b> 日つづけて記録しています` : "記録した日が続くと、ここに日数が出ます";
  const days = week(all, today);
  const goal = state.targets.kcal;
  const top = Math.max(goal * 1.2, ...days.map((d) => d.kcal), 1);
  $("week").innerHTML =
    // 目標の線：バーの段（上から 16px〜126px）の中の高さ
    `<div class="goal" style="top:${16 + 110 * (1 - goal / top)}px"><span>目標 ${fmt(goal)}</span></div>` +
    days
      .map((d) => {
        const [, m, dd] = d.date.split("-").map(Number);
        return `<div class="day-col${d.date === today ? " today" : ""}"><span class="v">${d.kcal ? fmt(d.kcal) : ""}</span><span class="col"><i style="height:${(d.kcal / top) * 100}%"></i></span><span>${m}/${dd}</span></div>`;
      })
      .join("");
  const top5 = menus(all).slice(0, 5);
  $("ranking").innerHTML = top5.length
    ? `<p class="ranking-title">🏅 よく食べるもの</p><ol class="ranking">${top5.map((m) => `<li><span>${esc(m.name)}</span><span>${m.count} 回</span></li>`).join("")}</ol>`
    : "";
}

// ---- 目標・控え ----
const TARGET_INPUTS = { tKcal: "kcal", tP: "p", tF: "f", tC: "c" };
function renderTargets() {
  Object.entries(TARGET_INPUTS).forEach(([id, k]) => ($(id).value = state.targets[k]));
}
Object.entries(TARGET_INPUTS).forEach(([id, k]) =>
  $(id).addEventListener("change", () => {
    // 全角の数字も読む。0 や数字でないときは前の目標のまま
    const v = num($(id).value);
    if (v > 0) state.targets[k] = Math.round(v);
    persist();
    render();
    // つないでいるときは、目標カロリーをボットにもそろえる（集計カード・20時のお知らせで使う）
    if (k === "kcal" && v > 0 && lineLog) saveProfile({ calorieTarget: Math.round(v) }, "🎯 目標カロリーを、食事記録ボットにもそろえました");
  })
);

$("exportBtn").addEventListener("click", async () => {
  const text = exportJson(state);
  const file = new File([text], `shoquji-${ymd()}.json`, { type: "application/json" });
  // スマホは共有シート（ファイルに保存・LINE の Keep など）、使えなければダウンロード
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "しょくじの記録の控え" });
      return;
    } catch (err) {
      // やめたときは何もしない。共有できなかったときは、下のダウンロードで
      if (err?.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say("⬇️ 控えを書き出しました");
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  // 控えは大きくても数 MB。それより大きいものは読まない
  if (file.size > 5 * 1024 * 1024) return say("読みこめませんでした（ファイルが大きすぎます）");
  try {
    const added = importJson(state, await file.text());
    persist();
    render();
    say(`⬆️ 控えを読みこみました（${added} 件ふえました）`);
  } catch {
    say("読みこめませんでした（しょくじで書き出した控えか確かめてください）");
  }
});

$("resetBtn").addEventListener("click", async () => {
  const ok = await LineShareUI.ask({ title: "記録をすべて消しますか？", text: "この端末のしょくじの記録を、すべて消します。もとに戻せません。", ok: "すべて消す", danger: true });
  if (!ok) return;
  const gasUrl = state.gasUrl; // つなぎ先は記録ではないので残す
  state = reset();
  state.gasUrl = gasUrl;
  persist();
  cancelEdit();
  render();
  say("記録をすべて消しました");
});

// ---- ほかの Q ツール（つづく）が読む、記録がある日の一覧 ----
// 同じサイト（katsuan.github.io）の同じブラウザなら、つづくが読んで「しょくじ連動」の習慣に ○ を付ける。
// 端末の記録に加えて、食事記録ボットで入れた記録の日も入れる（ボットの記録は端末の記録ではないので、shoquji:v1 だけでは見えない）
// 形：{ v: 1, days: ["YYYY-MM-DD", …] }（古い日から。中身は日付だけ）
const DAYS_KEY = "shoquji:days";
let daysWritten = "";
function writeDays() {
  const days = [...new Set(view().logs.map((l) => l.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const text = JSON.stringify({ v: 1, days });
  if (text === daysWritten) return;
  daysWritten = text;
  try {
    localStorage.setItem(DAYS_KEY, text);
  } catch {
    // 残せなくても、しょくじは使える
  }
}

// ---- まとめて描く ----
function render() {
  writeDays();
  renderDays();
  renderMeals();
  renderSuggest();
  renderDay();
  renderLookback();
  renderTargets();
  $("sendTextToggle").checked = state.sendText;
  $("formHeading").textContent = ui.botEdit ? "ボットの記録を直す" : ui.masterEdit ? "MYメニューを直す" : ui.editing ? "記録を直す" : `記録する（${dayOffset() === 0 ? "きょう" : label(ui.date)}）`;
  $("saveBtn").textContent = ui.masterEdit ? "📒 MYメニューに保存" : ui.editing || ui.botEdit ? "✏️ 直す" : "＋ 記録する";
  $("cancelEdit").hidden = !ui.editing && !ui.botEdit && !ui.masterEdit;
  document.querySelector(".meals").hidden = !!ui.masterEdit; // MYメニューには食事の区別がない
}

render();

// ---- 食事記録ボットの設定（目標・20時のお知らせ）と、よく記録するもの（📌 並べかえ・「⚡ よく記録」のメニュー） ----
const RICH_KEY = "shoquji:richOn"; // 「LINE のメニューにも出す」（この端末の設定）
const richOn = () => {
  try {
    return localStorage.getItem(RICH_KEY) !== "0";
  } catch {
    return true;
  }
};

// 開いたときに1回：ボットの目標・お知らせ・よく記録するもの・MYメニューを読む
async function readProfile() {
  if (!lineLog) return;
  const res = await lineLog.state();
  if (!res.ok) return; // 読めなくても、記録はできる（失敗の知らせは記録を読むほうで出す）
  const d = res.dashboard || {};
  profile = { user: d.user || {}, quickMenus: d.quickMenus || [], popularMenus: d.popularMenus || [], menus: res.menus || [], quickRichMenu: res.quickRichMenu || null };
  // 目標カロリーは、ボットのものにそろえる
  const target = Number(profile.user.calorieTarget) || 0;
  if (target > 0 && target !== state.targets.kcal) {
    state.targets.kcal = Math.round(target);
    persist();
  }
  $("botNotify").checked = profile.user.notify === true;
  render();
  renderPins();
  if (link.mode === "quick" && !link.usedQuick) {
    link.usedQuick = true;
    $("quickFold").open = true;
    $("quickFold").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  refreshRichMenuIfStale();
}

// 目標・お知らせを、ボットにも（送った項目だけ直る）
async function saveProfile(patch, doneText) {
  if (!lineLog) return;
  const res = await lineLog.profile(patch);
  if (!res.ok) return say(lineLogMessage(res.error));
  if (res.dashboard) profile = { ...profile, user: res.dashboard.user || profile.user, quickMenus: res.dashboard.quickMenus || profile.quickMenus, popularMenus: res.dashboard.popularMenus || profile.popularMenus };
  if (res.quickRichMenu) profile.quickRichMenu = res.quickRichMenu;
  if (doneText) say(doneText);
  return res;
}
$("botNotify").addEventListener("change", (e) => saveProfile({ notify: e.target.checked }, e.target.checked ? "🔔 20時のお知らせをオンにしました" : "20時のお知らせをオフにしました"));

const savedPins = () => (profile ? profile.quickMenus.filter((m) => m.pinned && m.masterKey).map((m) => m.masterKey) : []);
const byKey = () => new Map([...(profile?.menus || []), ...(profile?.quickMenus || [])].filter((m) => m.masterKey).map((m) => [m.masterKey, m]));

// 「⚡ よく記録」に並べる品：固定した順 → あいたところは記録の多い順（カロリーがわからない品は出さない）
function richItems(list = pins || savedPins()) {
  const map = byKey();
  const out = list.map((k) => map.get(k)).filter(Boolean).map((m) => ({ name: dn(m), kcal: m.kcal ?? null, pinned: true }));
  const used = new Set(out.map((i) => i.name));
  const popular = (profile?.popularMenus || []).map((m) => ({ ...m, kcal: m.kcal ?? (m.averageKcal || null) }));
  [...popular, ...(profile?.quickMenus || [])]
    .filter((m) => !(m.masterKey && list.includes(m.masterKey)) && m.kcal != null && !used.has(dn(m)))
    .forEach((m) => {
      used.add(dn(m));
      out.push({ name: dn(m), kcal: m.kcal, pinned: false });
    });
  return out.slice(0, RICH_LAYOUT.quickCount);
}
const richKey = (items) => JSON.stringify(items.map((i) => [i.name, i.kcal, i.pinned ? 1 : 0]));

// 開いたとき：LINE の「⚡ よく記録」が今の並びとちがえば、裏で描きなおして送る（まだなければ作る）
let richRefreshing = false;
async function refreshRichMenuIfStale() {
  if (!lineLog || !profile?.quickRichMenu || !richOn() || richRefreshing) return;
  const items = richItems(savedPins());
  if (!items.length) return;
  const key = richKey(items);
  if (profile.quickRichMenu.key === key) return;
  const existed = profile.quickRichMenu.has;
  richRefreshing = true;
  try {
    const res = await saveProfile({ richMenu: { image: await drawQuickMenu(items), items: items.map((i) => i.name), key } });
    if (res && res.richMenu && res.richMenu.ok && !existed) say("LINE のメニューの「⚡ よく記録」に、よく記録するものを並べました");
  } catch (error) {
    console.error(error);
  }
  richRefreshing = false;
}

// 📌 並べかえ（たたみ欄）
function renderPins() {
  if (!profile) return;
  const list = pins || savedPins();
  const map = byKey();
  $("pinCount").textContent = String(list.length);
  $("pinList").innerHTML = list.length
    ? list
        .map((k, i) => {
          const m = map.get(k) || { menu: "（消えたメニュー）" };
          return `<li class="pin-row"><span class="pin-name">📌 ${esc(dn(m))}${m.kcal != null ? `<small>${fmt(m.kcal)} kcal</small>` : ""}</span>
            <button type="button" data-pin-move="${esc(k)}" data-dir="-1" aria-label="上へ"${i === 0 ? " disabled" : ""}>↑</button>
            <button type="button" data-pin-move="${esc(k)}" data-dir="1" aria-label="下へ"${i === list.length - 1 ? " disabled" : ""}>↓</button>
            <button type="button" data-pin-del="${esc(k)}" aria-label="固定をやめる">✕</button></li>`;
        })
        .join("")
    : '<li class="ls-hint">まだありません。下の欄でさがして、押すと固定できます。</li>';
  const q = $("pinSearch").value.trim();
  const cands = (profile.menus || []).filter((m) => m.masterKey && !list.includes(m.masterKey) && (!q || dn(m).includes(q))).slice(0, 12);
  $("pinCands").innerHTML =
    cands
      .map(
        (m) => `<div class="cand-row"><span class="pin-name">${esc(dn(m))}${m.kcal != null ? `<small>${fmt(m.kcal)} kcal</small>` : ""}</span>
          <button class="ls-button is-small" type="button" data-pin-add="${esc(m.masterKey)}">📌 固定</button>
          <button class="ls-button is-small" type="button" data-master-edit="${esc(m.masterKey)}">✏️ 直す</button></div>`
      )
      .join("") || (q ? '<p class="ls-hint">見つかりません。MYメニューにある品だけ出ます。</p>' : "");
  $("richOn").checked = richOn();
  renderRichPreview();
}

let previewKey = "";
async function renderRichPreview() {
  if (!richOn() || !$("quickFold").open) {
    $("richPreview").innerHTML = "";
    previewKey = "";
    return;
  }
  const items = richItems();
  const key = richKey(items);
  if (key === previewKey) return;
  previewKey = key;
  const url = await drawQuickMenu(items);
  if (previewKey === key) $("richPreview").innerHTML = `<img src="${url}" alt="LINE のメニュー「⚡ よく記録」の見本">`;
}

$("quickFold").addEventListener("toggle", renderPins);
$("pinSearch").addEventListener("input", renderPins);
$("richOn").addEventListener("change", (e) => {
  try {
    localStorage.setItem(RICH_KEY, e.target.checked ? "1" : "0");
  } catch {
    // 残せなくても、いまはその設定で
  }
  renderPins();
});
$("quickFold").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-master-edit]");
  if (edit) return startMasterEdit(edit.dataset.masterEdit);
  const list = [...(pins || savedPins())];
  const add = e.target.closest("[data-pin-add]");
  const del = e.target.closest("[data-pin-del]");
  const move = e.target.closest("[data-pin-move]");
  if (add) {
    if (list.length >= 12) return say("固定できるのは 12 品までです");
    list.push(add.dataset.pinAdd);
  } else if (del) {
    list.splice(list.indexOf(del.dataset.pinDel), 1);
  } else if (move) {
    const i = list.indexOf(move.dataset.pinMove);
    const j = i + Number(move.dataset.dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  } else return;
  pins = list;
  renderPins();
});
$("savePins").addEventListener("click", async () => {
  if (!lineLog || !profile) return;
  const list = pins || savedPins();
  $("savePins").disabled = true;
  $("savePins").textContent = "保存中…";
  try {
    const items = richOn() ? richItems(list) : [];
    const richMenu = items.length ? { image: await drawQuickMenu(items), items: items.map((i) => i.name), key: richKey(items) } : null;
    const res = await saveProfile({ favorites: list, ...(richMenu ? { richMenu } : {}) });
    if (res) {
      // 返事に新しい並びがないときも、画面は保存した並びに
      if (!res.dashboard && profile) {
        const map = byKey();
        profile.quickMenus = [...list.map((k) => ({ ...map.get(k), pinned: true })), ...profile.quickMenus.filter((m) => !list.includes(m.masterKey)).map((m) => ({ ...m, pinned: false }))];
      }
      pins = null;
      if (res.richMenu && !res.richMenu.ok) say("並びは保存しました。LINE のメニューは作れませんでした。少し待って、もう一度ためしてね");
      else say(richMenu ? "📌 並びを保存して、LINE のメニューにも出しました" : "📌 よく記録するものの並びを保存しました");
    }
  } finally {
    $("savePins").disabled = false;
    $("savePins").textContent = "📌 この並びで保存";
    renderPins();
  }
});

// ---- 食事記録ボットのカード・リッチメニューから開いたとき（?mode=input|logs|summary|quick&meal=…&menu=…&mealDate=…&logId=…） ----
// LINE の中では LIFF が ?〜 に戻して届く。ブラウザで liff.line.me を開いたときは liff.state に入って届く
// 受けるのは、日付・食事・名前・数字・どこを見るかだけ（つなぎ先などは受けとらない。W5）
const link = readLink();
function readLink() {
  const url = new URL(location.href);
  let q = url.searchParams;
  if (!q.has("mode") && q.has("liff.state")) {
    try {
      q = new URLSearchParams(String(q.get("liff.state") || "").replace(/^[^?]*\?/, ""));
    } catch {
      q = new URLSearchParams();
    }
  }
  const get = (k, n = 40) => String(q.get(k) || "").trim().slice(0, n);
  const meal = get("meal", 4);
  let date = /^\d{4}-\d{2}-\d{2}$/.test(get("mealDate", 10)) ? get("mealDate", 10) : get("datePreset") === "yesterday" ? addDays(ymd(), -1) : "";
  if (date > ymd()) date = "";
  return {
    mode: ["input", "logs", "summary", "quick"].includes(get("mode")) ? get("mode") : "",
    meal: meal === "その他" ? "間食" : MEALS.includes(meal) ? meal : "",
    date,
    menu: get("menu"),
    nums: { kcal: num(q.get("kcal")), p: num(q.get("protein")), f: num(q.get("fat")), c: num(q.get("carb")) },
    logId: /^[A-Za-z0-9-]{1,60}$/.test(get("logId", 60)) ? get("logId", 60) : "",
    masterKey: /^[A-Za-z0-9_-]{1,64}$/.test(get("masterKey", 64)) ? get("masterKey", 64) : "",
    // MYメニューを直すとき、しょくじにない項目はそのまま残す
    keep: { flavor: get("flavor"), unit: get("unit"), note: get("note", 200), salt: num(q.get("salt")), fiber: num(q.get("fiber")) }
  };
}

function openFromLink() {
  if (!link.mode && !link.meal && !link.menu && !link.logId) return;
  // 一度読んだら、アドレスから消す（開きなおしで同じことをくり返さない）
  if (!inLineApp()) {
    const url = new URL(location.href);
    ["mode", "meal", "menu", "mealDate", "datePreset", "logId", "row", "masterKey", "kcal", "protein", "fat", "carb", "salt", "fiber", "flavor", "unit", "note", "liff.state"].forEach((k) => url.searchParams.delete(k));
    history.replaceState(null, "", url);
  }
  if (link.date) ui.date = link.date;
  if (link.meal) ui.meal = link.meal;
  if (link.menu && !link.logId) {
    fillEntry({ name: link.menu, ...link.nums });
    // よく食べるものの「MYメニューを直す」から：記録はふやさず、MYメニューだけ保存する
    if (link.masterKey) ui.masterEdit = { key: link.masterKey, keep: link.keep };
  }
  render();
  if (link.mode === "logs" || link.logId) $("dayTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  else if (link.mode === "summary") {
    $("lookback").open = true;
    $("lookback").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (link.mode === "quick" && !inLine) say("よく記録するものの並べかえは、LINE の中で開いたときにできます");
  else if (link.mode === "input" && !link.menu) setTimeout(() => $("name").focus(), 300);
}

// ---- LINE とつなぐ（くわしい人向け）----
$("gasField").hidden = !inLine;
$("reopenLink").href = OPEN_URL;
$("gasUrl").value = state.gasUrl;
// つなぐ GAS の URL（自分で入れたものだけ。URL の ?〜 からは受けとらない）
$("gasUrl").addEventListener("change", () => {
  const raw = $("gasUrl").value.trim();
  const url = cleanGasUrl(raw);
  $("gasUrlError").hidden = !raw || !!url;
  if (raw && !url) return;
  state.gasUrl = url;
  bot = [];
  persist();
  say(url ? "💬 つなぎ先を決めました" : LINE_LOG.gasUrl ? "つなぎ先をもとの食事記録ボットにもどしました" : "つなぎ先を消しました");
  connectLineLog();
});
openFromLink();
connectLineLog();

// ---- LINE で使う：ブラウザで開いたときの案内と、4コマ（最初だけ。閉じたら出さない）。つづくと同じ作り ----
const BANNER_KEY = "shoquji:lineBannerOff"; // この端末で閉じたか（設定なので端末に残してよい）
(function lineGuide() {
  const inside = inLineApp();
  let off = false;
  try {
    off = localStorage.getItem(BANNER_KEY) === "1";
  } catch {
    off = false;
  }
  const show = (open) => {
    $("lineGuidePanel").hidden = inside || !open;
  };
  show(!off);
  // 「LINEで開く」は、おくるんの共通の案内に（読みこめなければ、ふつうのリンク）
  if (!inside) {
    const shown = window.LineShareLiff?.outsideHelp?.($("lineOutside"), { appUrl: () => OPEN_URL, canLogin: false });
    if (!shown) $("lineOutside").innerHTML = `<a class="ls-button line is-block" href="${esc(OPEN_URL)}">💬 LINEで開く</a>`;
  }
  const remember = (value) => {
    try {
      if (value) localStorage.setItem(BANNER_KEY, "1");
      else localStorage.removeItem(BANNER_KEY);
    } catch {
      // 残せなくても、いまは閉じる・開く
    }
  };
  document.querySelectorAll("[data-close-line-guide]").forEach((b) =>
    b.addEventListener("click", () => {
      show(false);
      remember(true);
      say("LINE の案内を閉じました（「⚙️ LINE とつなぐ」からまた見られます）");
    })
  );
  document.querySelectorAll("[data-show-line-guide]").forEach((b) =>
    b.addEventListener("click", () => {
      remember(false);
      show(true);
      $("lineGuidePanel").hidden = false; // LINE の中でも見られるように
      $("lineGuidePanel").scrollIntoView({ behavior: "smooth", block: "start" });
    })
  );
})();

// 開いたまま日付が変わって戻ってきたら、「きょう」を見ていた人は新しいきょうへ（入力中・直している途中はそのまま）
let shownToday = ymd();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  readBot();
  const today = ymd();
  if (today === shownToday) return;
  const wasToday = ui.date === shownToday;
  shownToday = today;
  if (!wasToday || ui.editing || $("name").value.trim()) return render();
  ui.date = today;
  ui.meal = mealNow();
  render();
});

// はじめての人にだけ、使い方を3つ（「わかった」で消え、二度と出さない）
window.LineShareUI?.firstTip(
  "shoquji",
  ["食べたものを入れて「＋ 記録する」。前に食べたものは、下のボタンを押すと入ります", "記録の名前を押すと直せます。✕ で消しても「元に戻す」で戻せます", "記録はこの端末の中だけ。💬 LINEで送ると、カードで見せられます"],
  document.querySelector(".days")
);
