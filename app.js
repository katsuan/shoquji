// しょくじ（ShoQuji）の画面の入口：記録する・直す・消す・一覧・ふりかえり・目標・控えの操作と、部品をつなぐ。
// index.html が読む（type="module"）。記録の保存は js/store.js、計算は js/stats.js、
// くらぶボットとのつなぎは js/botlink.js（LINE 版でつないだときだけ）
import { MEALS, addLog, exportJson, importJson, load, num, removeLog, reset, restoreLog, save, updateLog } from "./js/store.js?v=202610291807";
import { addDays, byMeal, fmt, label, logsOf, mealNow, menus, streak, totals, week, weekStartOf, ymd } from "./js/stats.js?v=202610291807";
import { cleanGasUrl, fromBotMeal, inLineApp, lineLogMessage, toBotMeal } from "./js/linelog.js?v=202610291807";
import { createBotLink } from "./js/botlink.js?v=202610291807";
import { LINE_LOG, OPEN_URL } from "./js/line-config.js?v=202610291807";
import { byKey, dn, getProfile, initBotMenu, readProfile, saveProfile } from "./js/bot-menu.js?v=202610291807";
import { cardUrl } from "./js/card.js?v=202610291807";
import { writeDays } from "./js/days.js?v=202610291807";
import { readLink } from "./js/link.js?v=202610291807";
import { cancelRemoval, isWaiting } from "./js/removals.js?v=202610291807";
import { $, esc } from "./js/dom.js?v=202610291807";
import { saveNoteText } from "./js/outbox.js?v=202610291807";


let state = load();
const ui = {
  date: ymd(), // 記録する日・見る日
  meal: mealNow(),
  editing: null, // 直している記録の id
  botEdit: null, // 直している、くらぶボットの記録の logId（LINE の中でつないだとき）
  masterEdit: null, // 保存する MYメニュー { key, keep, toMine }（ボットのカードの「MYメニューを直す」・MYメニューの欄から）
  base: null, // MYメニュー・候補から入れた数字（量の倍率のもと）。{ kcal, p, f, c }
  scale: 1, // いまの倍率
  est: null, // ご飯◯杯分で選んだもの（"0.5"・"1"…・"few"）。カロリーを自分で入れたら null
  justAdded: null // 記録したばかりの id（一覧で少し光らせる）
};

const link = readLink(); // ボットのカード・メニューから開いたときの指定（js/link.js）

const NUTRI = ["kcal", "p", "f", "c"];

// いまの記録を端末に残す。残せなければ（プライベートブラウズなど）知らせる
function persist() {
  if (!save(state)) say("この端末に残せませんでした（プライベートブラウズでは、閉じると消えます）");
}

// ---- くらぶボット（LINE 版で、つないだときだけ。js/botlink.js） ----
let me = null; // 見出しの右の本人のアイコン（shared/line-me.js。ブラウザ版では null）
const botLink = createBotLink({ state: () => state, ui, link, render, persist, say, cancelEdit, startBotEdit, changed: () => drawStatus() });
// くらぶボットへの呼び出し口（js/linelog.js。つないでいなければ null）
const lineLog = () => botLink.client(); // つないでいなければ null
// 画面に出す中身：この端末の記録＋ボットで入れた記録
const view = () => botLink.view(); // 画面に出す中身：この端末の記録＋ボットで入れた記録

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

// 「きょう・きのう・日付」のボタンと日付の欄を、いま見ている日に合わせる
function renderDays() {
  const off = dayOffset();
  document.querySelectorAll("[data-day]").forEach((b) => b.classList.toggle("is-active", Number(b.dataset.day) === off));
  const pick = document.querySelector(".date-pick");
  pick.classList.toggle("is-active", off === null);
  $("pickLabel").textContent = off === null ? `📅 ${label(ui.date)}` : "📅 日付";
  $("datePick").value = ui.date;
  $("datePick").max = ymd();
}

// 見る日・記録する日を変えて、直している途中ならやめて描きなおす
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
  box.innerHTML = MEALS.map((m) => `<button class="ls-chip ${mealClass(m)}" type="button" role="radio" aria-checked="${m === ui.meal}" aria-pressed="${m === ui.meal}" data-meal="${m}">${m}</button>`).join("");
  // 食べたものの欄までの枠も、選んでいる食事の色に
  $("mealFrame").className = `meal-frame ${mealClass(ui.meal)}`;
  renderEst(); // 間食だけ「少し」がある
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
  const profile = getProfile();
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

// 入力中の名前に合う「よく食べるもの」のボタンを出す
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

// ---- だいたいのカロリー（ご飯◯杯分） ----
// くらぶボットと同じ目安：ご飯1杯（150g）≈ 240kcal。朝・昼・夜は½〜3杯、間食は「少し」〜1.5杯
const RICE_BOWL_KCAL = 240;
function estOptions(meal) {
  const bowls = meal === "間食" ? [{ key: "few", label: "🍬 少し", kcal: 80 }, 0.5, 1, 1.5] : [0.5, 1, 1.5, 2, 3];
  return bowls.map((b) => (typeof b === "object" ? b : { key: String(b), label: `${b === 0.5 ? "½" : b}杯`, kcal: Math.round(RICE_BOWL_KCAL * b) }));
}
// ボタンを描く（押したものは選んだ印。カロリーを自分で入れたら外れる）
function renderEst() {
  const opts = estOptions(ui.meal);
  if (ui.est && !opts.some((o) => o.key === ui.est)) ui.est = null; // 食事を切りかえて、その量がなくなったとき
  $("estChips").style.setProperty("--n", opts.length);
  $("estChips").innerHTML = opts
    .map((o) => `<button class="ls-chip" type="button" data-est="${o.key}" aria-pressed="${o.key === ui.est}">${o.label}<small>${o.kcal}kcal</small></button>`)
    .join("");
}
$("estChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-est]");
  if (!b) return;
  const o = estOptions(ui.meal).find((x) => x.key === b.dataset.est);
  if (!o) return;
  // もう一度押すと取り消す
  ui.est = ui.est === o.key ? null : o.key;
  $("kcal").value = ui.est ? o.kcal : "";
  hideKcalError();
  // 前に食べたものの数字の倍率は、だいたいで入れたら使わない
  ui.base = null;
  ui.scale = 1;
  renderScale();
  renderEst();
});

// 前に食べたものを入れる（名前と、最後に入れたカロリー・PFC）
function fillMenu(m) {
  fillEntry(m, { openOnly: true });
  renderSuggest();
}

// カロリーの欄の赤い文字を消す
function hideKcalError() {
  $("kcalError").hidden = true;
  $("kcal").removeAttribute("aria-invalid");
}
$("kcal").addEventListener("input", () => {
  hideKcalError();
  // 自分で数字を入れたら、ご飯◯杯分の選んだ印は外す
  if (ui.est) {
    ui.est = null;
    renderEst();
  }
});

// 名前の欄の赤い文字を消す
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

// 入力欄を空にもどす（名前・数字・倍率・赤い文字）
function clearForm() {
  $("name").value = "";
  hideNameError();
  hideKcalError();
  NUTRI.forEach((k) => ($(k).value = ""));
  ui.base = null;
  ui.scale = 1;
  ui.est = null;
  renderScale();
  renderEst();
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
    if (edited) botLink.sendSaved(edited, { edited: true });
  } else {
    const log = addLog(state, entry);
    ui.justAdded = log.id;
    // 季節の絵文字をときどき（Q キットの season.js。読めていなければ付けない）
    const done = `🍚 ${label(ui.date)} の${ui.meal}に「${entry.name.trim()}」を記録しました ↓`;
    say(window.QSeason ? QSeason.decorate(done) : done);
    botLink.sendSaved(log);
  }
  savedAt = Date.now();
  persist();
  clearForm();
  render();
});

// ボットの記録を直す・MYメニューを保存する（端末の記録はふやさない）。カロリーは要る
let savingRemote = false;
// ボットの記録を直す・MYメニューを保存する（端末の記録はふやさない。カロリーは要る）
async function saveRemote(entry) {
  if (savingRemote) return;
  if (!lineLog()) return say("ボットの記録・MYメニューは、LINE 版で直せます");
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
  const res = ui.botEdit ? await lineLog().update(ui.botEdit, e) : await lineLog().saveMaster(ui.masterEdit.key, e, ui.masterEdit.keep);
  savingRemote = false;
  $("saveBtn").disabled = false;
  if (!res.ok) {
    render();
    return say(lineLogMessage(res.error));
  }
  if (ui.botEdit) {
    // 画面のボットの記録も、返事を待たずに直す（次に読んだときにそろう）
    const b = botLink.find(ui.botEdit);
    if (b) Object.assign(b, { date: e.date, meal: toBotMeal(e.meal), menu: e.name, kcal: e.kcal, protein: e.p, fat: e.f, carb: e.c });
    say(`✏️ 「${e.name}」を直しました（くらぶボットにも）`);
  } else {
    const toMine = ui.masterEdit.toMine;
    if (toMine) {
      // 共通から自分用の写しができた：MYメニューと固定を読みなおす（自分の品が先に出る）
      readProfile();
    } else {
      // 画面の MYメニューも、返事を待たずに直す（次に開いたときにそろう）
      const m = getProfile()?.menus?.find((x) => x.masterKey && x.masterKey === ui.masterEdit.key);
      if (m) Object.assign(m, { menu: e.name, kcal: e.kcal, protein: e.p, fat: e.f, carb: e.c });
    }
    const saved = toMine ? `📒 「${e.name}」を自分用の MYメニューにしました` : `📒 MYメニューの「${e.name}」を保存しました`;
    say(`${window.QSeason ? window.QSeason.decorate(saved) : saved}。次からトークで名前を送るだけで記録できます`);
  }
  savedAt = Date.now();
  ui.botEdit = null;
  ui.masterEdit = null;
  clearForm();
  render();
  botLink.read(true);
}

// 名前とカロリー・PFC を入力欄に入れる。数字があれば「栄養も入れる」を開く（openOnly のときは、閉じはしない）
function fillEntry(e, { openOnly = false } = {}) {
  $("name").value = e.name || "";
  hideNameError();
  NUTRI.forEach((k) => ($(k).value = e[k] ?? ""));
  const has = NUTRI.some((k) => e[k] != null);
  if (has || !openOnly) $("nutri").open = has;
  // 量の倍率のもと（数字があるときだけ）
  ui.base = has ? Object.fromEntries(NUTRI.map((k) => [k, num(e[k])])) : null;
  ui.scale = 1;
  ui.est = null;
  renderScale();
  renderEst();
}

// 量の倍率：もとの数字に倍率をかけて入れなおす（大盛り・半分など）
function renderScale() {
  $("scaleRow").hidden = !ui.base;
  document.querySelectorAll("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.scale) === ui.scale)));
}
$("scaleRow").addEventListener("click", (e) => {
  const b = e.target.closest("[data-scale]");
  if (!b || !ui.base) return;
  ui.scale = Number(b.dataset.scale);
  NUTRI.forEach((k) => ($(k).value = ui.base[k] == null ? "" : Math.round(ui.base[k] * ui.scale * 10) / 10));
  $("nutri").open = true;
  ui.est = null;
  renderScale();
  renderEst();
});

// MYメニューを入力欄に開いて直す（「📌 よく記録するもの・MYメニュー」から）
function startMasterEdit(key) {
  const m = byKey().get(key);
  if (!m) return;
  ui.editing = null;
  ui.botEdit = null;
  // 共通の品は、管理者でなければ自分用の写しとして保存する（共通は変わらない。ボット側が写しを作る）
  const toMine = m.scope === "common" && !getProfile()?.isAdmin;
  ui.masterEdit = { key, toMine, keep: { flavor: m.flavor, unit: m.unit, note: m.note, salt: m.salt, fiber: m.fiber } };
  // 名前の欄は、種類・量をのぞいた名前（種類・量・メモは、そのまま残す）
  fillEntry({ name: m.menu || dn(m), kcal: m.kcal, p: m.protein, f: m.fat, c: m.carb });
  render();
  $("formTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ボットの記録を、入力欄に開く（ボットのカードの「画面で詳しく」・一覧の「ボット」の記録を押したとき）
function startBotEdit(logId) {
  const b = botLink.find(logId);
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

// この端末の記録を、入力欄に開いて直せるようにする
function startEdit(id) {
  const log = state.logs.find((l) => l.id === id);
  if (!log) return;
  ui.editing = id;
  ui.meal = log.meal;
  fillEntry(log);
  render();
  $("formTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}

// 直している途中ならやめて、入力欄を空にもどす
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
// 朝・昼・夜・間食の色（style.css の .m0〜.m3。朝＝黄・昼＝緑・夜＝藍・間食＝ピンク）
function mealClass(meal) {
  return `m${Math.max(0, MEALS.indexOf(meal))}`;
}

// 食事ごとの色のバー（横）。rows は byMeal の形。scale はバーの右はしにあたるカロリー
function mealBarHtml(rows, scale, { over = false, goal = 0 } = {}) {
  const segs = rows
    .filter((r) => r.kcal > 0)
    .map((r) => `<i class="${mealClass(r.meal)}" style="width:${(r.kcal / scale) * 100}%" title="${r.meal} ${fmt(r.kcal)} kcal"></i>`)
    .join("");
  // 目標をこえた日は、目標のところに線
  const mark = over && goal > 0 ? `<span class="goal-mark" style="left:${(goal / scale) * 100}%" aria-hidden="true"></span>` : "";
  return `<div class="bar stack${over ? " over" : ""}">${segs}${mark}</div>`;
}

// 食事ごとの割合とカロリーを、入力欄のタブと同じ朝・昼・夜・間食の横並びで（1つずつ「● 朝 16%」「平均 215 kcal」の2行）。
// 記録のない食事も薄く出す（どれがないかわかるように）。avgDays を渡すと「1日平均」も
function mealSplitHtml(rows, avgDays = 0) {
  if (!rows.some((r) => r.kcal > 0)) return "";
  return `<ul class="meal-split">${rows
    .map((r) => {
      const kcal = avgDays ? Math.round(r.kcal / avgDays) : r.kcal;
      const zero = r.kcal > 0 ? "" : " is-zero";
      return `<li class="${mealClass(r.meal)}${zero}"><span class="name">${r.meal}<b>${r.pct}%</b></span>${avgDays ? `<small>平均</small>` : ""}<small>${fmt(kcal)} kcal</small></li>`;
    })
    .join("")}</ul>`;
}

function pct(v, goal) {
  return goal > 0 ? Math.min(100, Math.round((v / goal) * 100)) : 0;
}

// 合計カロリーと目標のバー（朝・昼・夜・間食の色で積む）と、食事ごとの割合、PFC
function totalsHtml(logs, t, g) {
  const missing = t.count - t.withKcal;
  // PFC は、入れた品がある日だけ出す（入れていないのに「0 g」と出ると、食べていないように見えるため）
  const hasPfc = logs.some((l) => l.p != null || l.f != null || l.c != null);
  const pfc = [["p", "たんぱく質"], ["f", "脂質"], ["c", "炭水化物"]]
    .map(([k, name]) => `<div class="${k}">${name}<b>${fmt(t[k])}<small> / ${fmt(g[k])}g</small></b><span class="bar"><i style="width:${pct(t[k], g[k])}%"></i></span></div>`)
    .join("");
  return `
      <div class="kcal-line"><b>${fmt(t.kcal)}<small>kcal</small></b><span>目標 ${fmt(g.kcal)} kcal（${pct(t.kcal, g.kcal)}%）</span></div>
      ${mealBarHtml(byMeal(logs), Math.max(g.kcal, t.kcal, 1), { over: t.kcal > g.kcal, goal: g.kcal })}
      ${mealSplitHtml(byMeal(logs))}
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
    const name = lineLog()
      ? `<button class="name" type="button" data-bot-edit="${esc(l.logId)}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>`
      : `<span class="bot-name">${esc(l.name)}</span>`;
    return `<div class="item is-bot${l.logId === ui.botEdit ? " is-editing" : ""}">
            ${name}
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <span class="bot-tag" title="くらぶボットで入れた記録">ボット</span>
            ${lineLog() ? `<button class="del" type="button" data-bot-del="${esc(l.logId)}" aria-label="${esc(l.name)} を消す">✕</button>` : ""}
          </div>`;
  }
  return `<div class="item${l.id === ui.editing ? " is-editing" : ""}${l.id === ui.justAdded ? " is-new" : ""}">
            <button class="name" type="button" data-edit="${esc(l.id)}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <button class="del" type="button" data-del="${esc(l.id)}" aria-label="${esc(l.name)} を消す">✕</button>
          </div>`;
}

// その日の記録を、食事ごとのまとまりの HTML にする
function dayListHtml(logs) {
  return MEALS.map((meal) => {
    const items = logs.filter((l) => l.meal === meal);
    if (!items.length) return "";
    return `<div class="meal-group"><span class="meal-tag ${mealClass(meal)}">${meal}</span><div class="items">${items.map(itemHtml).join("")}</div></div>`;
  }).join("");
}

let emptyEmoji = null; // 記録がない日のあいさつに付ける季節の絵文字（"" は付けない）
// 「この日のしょくじ」（合計と目標・食事ごとの一覧・カードで送る）を描く
function renderDay() {
  const logs = logsOf(view(), ui.date);
  const t = totals(logs);
  const off = dayOffset();
  $("dayHeading").textContent = off === 0 ? "きょうのしょくじ" : off === -1 ? "きのうのしょくじ" : `${label(ui.date)}のしょくじ`;

  if (!logs.length) {
    $("totals").innerHTML = "";
    // 季節の絵文字をときどき（Q キットの season.js が読めてから1回だけ決めて、描きなおしても変えない）
    if (emptyEmoji === null && window.QSeason) emptyEmoji = window.QSeason.maybe();
    $("dayList").innerHTML = `<div class="ls-empty"><span class="ls-empty-icon" aria-hidden="true">🍙</span>まだ記録がありません。上で食べたものを入れてみましょう${emptyEmoji ? ` ${esc(emptyEmoji)}` : ""}</div>`;
  } else {
    $("totals").innerHTML = totalsHtml(logs, t, state.targets);
    $("dayList").innerHTML = dayListHtml(logs);
  }
  ui.justAdded = null;
  // カードで送る：記録があるときだけ出す。記録用の文字をオンにしていれば、そのことを小さく
  $("sendArea").hidden = !logs.length;
  $("sendTextNote").hidden = !state.sendText;
  $("sendBtn").href = logs.length ? cardUrl(ui.date, logs, t, { sendText: state.sendText }) : "#";
}

$("dayList").addEventListener("click", (e) => {
  const botEdit = e.target.closest("[data-bot-edit]");
  if (botEdit) return startBotEdit(botEdit.dataset.botEdit);
  const botDel = e.target.closest("[data-bot-del]");
  if (botDel) return botLink.removeBot(botDel.dataset.botDel);
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
  botLink.removeOwnLater(log);
  say(`🗑 「${log.name}」を消しました`, () => {
    // もうボットから消してしまっていたら（閉じかけて送ったなど）、もう一度入れる
    const already = !isWaiting(`own:${log.id}`);
    cancelRemoval(`own:${log.id}`);
    restoreLog(state, log);
    persist();
    render();
    if (already) botLink.sendSaved(log);
  });
});

$("sendTextToggle").addEventListener("change", (e) => {
  state.sendText = e.target.checked;
  persist();
  render();
});

// ---- ふりかえり ----
let weekOffset = 0; // 見ている週（0＝今週、-1＝先週…）

// 週のはじまり（Q 共通の設定。読めなければ月曜）
function weekStart() {
  try {
    return window.QWeekStart ? window.QWeekStart.get(1) : 1;
  } catch {
    return 1;
  }
}

// 「10/20〜10/26」の形
function rangeLabel(from, to) {
  const md = (d) => d.split("-").slice(1).map(Number).join("/");
  return `${md(from)}〜${md(to)}`;
}

// 「ふりかえり」（続けた日数・週のカロリー・食事ごとの割合・よく食べるもの）を描く
// 週のはじまりのボタン（⚙️ 設定）の押されている印をそろえる
function renderWeekStart() {
  const now = weekStart();
  document.querySelectorAll("[data-week-start]").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.weekStart) === now)));
}
// 週のはじまりを変える（Q 共通の設定。ほかの Q のツールも同じ週のはじまりで開く）
$("weekStart").addEventListener("click", (e) => {
  const b = e.target.closest("[data-week-start]");
  if (!b) return;
  window.QWeekStart?.set(Number(b.dataset.weekStart));
  weekOffset = 0;
  renderWeekStart();
  renderLookback();
});

function renderLookback() {
  const today = ymd();
  const all = view();
  const n = streak(all, today);
  $("streak").innerHTML = n ? `🔥 <b>${n}</b> 日つづけて記録しています` : "記録した日が続くと、ここに日数が出ます";
  const start = weekStart();
  const days = week(all, today, { start, offset: weekOffset });
  // もどれるのは、いちばん古い記録の週まで
  const oldest = all.logs.reduce((m, l) => (l.date < m ? l.date : m), today);
  $("weekPrev").disabled = days[0].date <= weekStartOf(oldest, start);
  $("weekNext").disabled = weekOffset >= 0;
  $("weekLabel").textContent = `${weekOffset === 0 ? "今週" : weekOffset === -1 ? "先週" : "この週"}　${rangeLabel(days[0].date, days[6].date)}`;
  $("week").setAttribute("aria-label", `${rangeLabel(days[0].date, days[6].date)} のカロリー`);
  const goal = state.targets.kcal;
  const top = Math.max(goal * 1.2, ...days.map((d) => d.kcal), 1);
  $("week").innerHTML =
    // 目標の線：バーの段（上から 16px〜126px）の中の高さ
    `<div class="goal" style="top:${16 + 110 * (1 - goal / top)}px"><span>目標 ${fmt(goal)}</span></div>` +
    days
      .map((d) => {
        const [y, m, dd] = d.date.split("-").map(Number);
        // 棒は朝・昼・夜・間食の色を下から積む
        const segs = d.meals
          .filter((r) => r.kcal > 0)
          .map((r) => `<i class="${mealClass(r.meal)}" style="flex-grow:${r.kcal}"></i>`)
          .join("");
        const dow = "日月火水木金土"[new Date(y, m - 1, dd).getDay()];
        return `<div class="day-col${d.date === today ? " today" : ""}${d.future ? " future" : ""}"><span class="v">${d.kcal ? fmt(d.kcal) : ""}</span><span class="col"><span class="stack" style="height:${(d.kcal / top) * 100}%">${segs}</span></span><span>${m}/${dd}</span><span class="dow">${dow}</span></div>`;
      })
      .join("");
  // この7日の、食事ごとの割合（カロリーを入れた日の平均も）
  const weekRows = byMeal(days.flatMap((d) => d.meals));
  const kcalDays = days.filter((d) => d.kcal > 0).length;
  $("weekSplit").innerHTML = kcalDays
    ? `<p class="ranking-title">🍽 ${weekOffset === 0 ? "今週" : weekOffset === -1 ? "先週" : "この週"}の朝・昼・夜・間食</p>${mealBarHtml(weekRows, Math.max(1, weekRows.reduce((n, r) => n + r.kcal, 0)))}${mealSplitHtml(weekRows, kcalDays)}`
    : "";
  const top5 = menus(all).slice(0, 5);
  $("ranking").innerHTML = top5.length
    ? `<p class="ranking-title">🏅 よく食べるもの</p><ol class="ranking">${top5.map((m) => `<li><span>${esc(m.name)}</span><span>${m.count} 回</span></li>`).join("")}</ol>`
    : "";
}

$("weekPrev").addEventListener("click", () => {
  weekOffset--;
  renderLookback();
});
$("weekNext").addEventListener("click", () => {
  weekOffset = Math.min(0, weekOffset + 1);
  renderLookback();
});

// ---- 目標・控え ----
const TARGET_INPUTS = { tKcal: "kcal", tP: "p", tF: "f", tC: "c" };
// 目標の欄に、いまの目標を入れる
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
    if (k === "kcal" && v > 0 && lineLog()) saveProfile({ calorieTarget: Math.round(v) }, "🎯 目標カロリーを、くらぶボットにもそろえました");
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
  writeDays(view().logs);
  renderDays();
  renderMeals();
  renderSuggest();
  renderDay();
  renderWeekStart();
  renderLookback();
  renderTargets();
  $("sendTextToggle").checked = state.sendText;
  $("formHeading").textContent = ui.botEdit ? "ボットの記録を直す" : ui.masterEdit ? (ui.masterEdit.toMine ? "共通の MYメニューを自分用にする" : "MYメニューを直す") : ui.editing ? "記録を直す" : `記録する（${dayOffset() === 0 ? "きょう" : label(ui.date)}）`;
  $("saveBtn").textContent = ui.masterEdit ? (ui.masterEdit.toMine ? "📒 自分用に保存" : "📒 MYメニューに保存") : ui.editing || ui.botEdit ? "✏️ 直す" : "＋ 記録する";
  $("cancelEdit").hidden = !ui.editing && !ui.botEdit && !ui.masterEdit;
  document.querySelector(".meals").hidden = !!ui.masterEdit; // MYメニューには食事の区別がない
  drawStatus(); // 記録がふえた・へったら「まだ送っていません」の数も
}

render();
initBotMenu({ lineLog, state: () => state, ui, link, render, persist, say, startMasterEdit });

// ---- くらぶボットのカード・リッチメニューから開いたとき（指定の読みとりは js/link.js） ----
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
  } else if (link.mode === "quick" && !botLink.inLine) say("よく記録するものの並べかえは、LINE 版でできます");
  else if (link.mode === "input" && !link.menu) setTimeout(() => $("name").focus(), 300);
}

// ---- くらぶボットとつなぐ（くわしい人向け）----
$("gasField").hidden = !botLink.inLine;
$("reopenLink").href = OPEN_URL;
$("gasUrl").value = state.gasUrl;
// つなぐ GAS の URL（自分で入れたものだけ。URL の ?〜 からは受けとらない）
$("gasUrl").addEventListener("change", () => {
  const raw = $("gasUrl").value.trim();
  const url = cleanGasUrl(raw);
  $("gasUrlError").hidden = !raw || !!url;
  if (raw && !url) return;
  state.gasUrl = url;
  botLink.forget();
  persist();
  say(url ? "🔗 つなぎ先を決めました" : LINE_LOG.gasUrl ? "つなぎ先をもとのくらぶボットにもどしました" : "つなぎ先を消しました");
  botLink.connect();
});
openFromLink();
// ---- LINE 版の「わたし」：見出しの右に本人のアイコン。押すと、ログイン・くらぶボットとのつながり・まだ送っていない記録（Q キットの shared/line-me.js） ----
me = window.QLineMe?.mount({
  liffId: LINE_LOG.liffId,
  botName: "くらぶボット",
  connected: () => !!botLink.client(),
  pending: () => botLink.pending(),
  retry: () => botLink.retry(),
  onSettings: () => window.QLineMe.openFold("lineFold"),
  // 「⚙️ 設定」：ページの下の設定の欄（目標・送り方・週のはじまり・記録の控え。q-oqrn の ux.md A7）
  onPrefs: () => window.QLineMe.openFold("settings")
});
// まだ送っていない記録・ログインしていないときの1行と、アイコンの数の印を描きなおす（送れた・つながった・電波が変わったとき）
function drawStatus() {
  me?.update();
  const text = saveNoteText({ inLine: botLink.inLine, pending: botLink.pending(), loggedIn: me?.status?.().loggedIn });
  $("saveNote").textContent = text;
  $("saveNote").hidden = !text;
}
window.addEventListener("online", drawStatus);
window.addEventListener("offline", drawStatus);
botLink.connect().finally(drawStatus);

// ---- LINE 版で使う：ブラウザで開いたときの案内と、4コマ（最初だけ。閉じたら出さない。Q キットの shared/botlink.js の guide） ----
window.QBotLink?.guide({
  key: "shoquji:lineBannerOff", // この端末で閉じたか（設定なので端末に残してよい）
  openUrl: OPEN_URL,
  say,
  closedText: "案内を閉じました（「🔗 くらぶボットとつなぐ」からまた見られます）"
});

// 開いたまま日付が変わって戻ってきたら、「きょう」を見ていた人は新しいきょうへ（入力中・直している途中はそのまま）
let shownToday = ymd();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  botLink.read();
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
  ["食べたものを入れて「＋ 記録する」。前に食べたものは、下のボタンを押すと入ります", "記録の名前を押すと直せます。✕ で消しても「元に戻す」で戻せます", "ブラウザ版の記録はこの端末の中だけ。LINE 版なら、くらぶボットのシートにも残ります"],
  document.querySelector(".days")
);
