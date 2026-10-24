// しょくじ（ShoQuji）：画面の操作。記録はこの端末の中だけ（js/store.js）、計算は js/stats.js
import { MEALS, addLog, exportJson, importJson, load, markSent, num, removeLog, reset, restoreLog, save, updateLog } from "./js/store.js?v=202610241500";
import { addDays, fmt, label, logsOf, mealNow, menus, streak, totals, week, ymd } from "./js/stats.js?v=202610241500";
import { botLogsForView, cleanGasUrl, inLineApp, lineLogMessage, startLineLog } from "./js/linelog.js?v=202610241500";
import { LINE_LOG, OPEN_URL } from "./js/line-config.js?v=202610241500";

const $ = (id) => document.getElementById(id);
const PAGE_URL = "https://katsuan.github.io/shoquji/";
const CARD_COLOR = "#EC8A16"; // ロゴの玉子焼きの黄色

let state = load();
const ui = {
  date: ymd(), // 記録する日・見る日
  meal: mealNow(),
  editing: null, // 直している記録の id
  justAdded: null // 記録したばかりの id（一覧で少し光らせる）
};

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NUTRI = ["kcal", "p", "f", "c"];

function persist() {
  if (!save(state)) say("この端末に残せませんでした（プライベートブラウズでは、閉じると消えます）");
}

// ---- 食事記録ボット（LINE の中で開いて、つないだときだけ。js/linelog.js） ----
let lineLog = null; // startLineLog の返事（つなげないときは null）
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
  return { ...state, logs: [...state.logs, ...botLogsForView(bot, state.logs, state.deleted)] };
}

// 記録をボットにも入れる（同じ id は何度送っても1回だけ入る）。うまくいかなければ「もう一度」
async function sendToBot(logs, { quiet = false } = {}) {
  if (!lineLog || !logs.length) return;
  const res = await lineLog.record(logs);
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
async function readBot(force = false) {
  if (!lineLog || (!force && Date.now() - lastRead < 60000)) return;
  lastRead = Date.now();
  const res = await lineLog.list(addDays(ymd(), -(BOT_DAYS - 1)), ymd());
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
    if (!client) {
      $("whereNote").hidden = true;
      return had && render();
    }
    lineLog = client;
    $("whereNote").innerHTML = "📱 LINE で開いたしょくじの記録は、Safari などのブラウザで開いたときとは<b>別</b>です。<br>記録すると、食事記録ボットにも入ります。"; // qcheck-ok: W1 決まった文字だけ
    $("whereNote").hidden = false;
    render();
    await sendUnsent();
    await readBot(true);
    if (link.logId) showLinkedLog(link.logId);
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
function renderSuggest() {
  const q = $("name").value.trim();
  const list = menus(view())
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
  const m = menus(view()).find((x) => x.name === $("name").value.trim());
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
  if (ui.editing) {
    updateLog(state, ui.editing, entry);
    say(`✏️ 「${entry.name.trim()}」を直しました`);
    ui.editing = null;
  } else {
    const log = addLog(state, entry);
    ui.justAdded = log.id;
    say(`🍚 ${label(ui.date)} の${ui.meal}に「${entry.name.trim()}」を記録しました ↓`);
    sendToBot([log], { quiet: true });
  }
  savedAt = Date.now();
  persist();
  clearForm();
  render();
});

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
  if (!ui.editing) return;
  ui.editing = null;
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
  // ボットで入れた記録：見るだけ（直す・消すはボットのトークか食事記録の画面で）
  if (l.bot) {
    return `<div class="item is-bot">
            <span class="bot-name">${esc(l.name)}</span>
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <span class="bot-tag" title="食事記録ボットで入れた記録">ボット</span>
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

function renderDay() {
  const logs = logsOf(view(), ui.date);
  const t = totals(logs);
  const off = dayOffset();
  $("dayHeading").textContent = off === 0 ? "きょうのしょくじ" : off === -1 ? "きのうのしょくじ" : `${label(ui.date)}のしょくじ`;

  if (!logs.length) {
    $("totals").innerHTML = "";
    $("dayList").innerHTML = '<div class="ls-empty"><span class="ls-empty-icon" aria-hidden="true">🍙</span>まだ記録がありません。上で食べたものを入れてみましょう</div>';
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
  say(`🗑 「${log.name}」を消しました`, () => {
    restoreLog(state, log);
    persist();
    render();
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

// ---- まとめて描く ----
function render() {
  renderDays();
  renderMeals();
  renderSuggest();
  renderDay();
  renderLookback();
  renderTargets();
  $("sendTextToggle").checked = state.sendText;
  $("formHeading").textContent = ui.editing ? "記録を直す" : `記録する（${dayOffset() === 0 ? "きょう" : label(ui.date)}）`;
  $("saveBtn").textContent = ui.editing ? "✏️ 直す" : "＋ 記録する";
  $("cancelEdit").hidden = !ui.editing;
}

render();

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
    logId: /^[A-Za-z0-9-]{1,60}$/.test(get("logId", 60)) ? get("logId", 60) : ""
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
    $("name").value = link.menu;
    NUTRI.forEach((k) => ($(k).value = link.nums[k] ?? ""));
    if (NUTRI.some((k) => link.nums[k] != null)) $("nutri").open = true;
  }
  render();
  if (link.mode === "logs" || link.logId) $("dayTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  else if (link.mode === "summary") {
    $("lookback").open = true;
    $("lookback").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (link.mode === "quick") say("よく記録するものの並べかえは、まだしょくじにありません。よく食べるものは、名前の欄の下に出ます");
  else if (link.mode === "input" && !link.menu) setTimeout(() => $("name").focus(), 300);
}

// カードの「画面で詳しく」から、ボットの記録（logId）を開いたとき：その日を出し、直し方を知らせる
function showLinkedLog(logId) {
  const b = bot.find((x) => String(x.logId) === logId);
  if (!b) return;
  if (b.date && b.date !== ui.date) {
    ui.date = b.date;
    render();
  }
  if (b.kcal == null) {
    // カロリーがまだの品：名前を入れて、カロリーから入れられるように（記録はしょくじに1件ふえる。ボットの記録はトークで直す）
    say(`「${b.menu}」のカロリーは、トークで数字を送ると入ります（例：350）`);
  } else {
    say(`「${b.menu}」はボットで入れた記録です。しょくじでは、まだ直せません`);
  }
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
