// しょくじ（ShoQuji）：画面の操作。記録はこの端末の中だけ（js/store.js）、計算は js/stats.js
import { MEALS, addLog, exportJson, importJson, load, removeLog, reset, restoreLog, save, updateLog } from "./js/store.js?v=202610221446";
import { addDays, fmt, label, logsOf, mealNow, menus, streak, totals, week, ymd } from "./js/stats.js?v=202610221446";

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
  const list = menus(state)
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
  NUTRI.forEach((k) => ($(k).value = m[k] ?? ""));
  if (NUTRI.some((k) => m[k] != null)) $("nutri").open = true;
  renderSuggest();
}

$("name").addEventListener("input", renderSuggest);
// 名前を入れ終えたとき、同じ名前を前に食べていれば栄養も入れる（空の欄だけ）
$("name").addEventListener("change", () => {
  const m = menus(state).find((x) => x.name === $("name").value.trim());
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
  NUTRI.forEach((k) => ($(k).value = ""));
  renderSuggest();
}

$("saveBtn").addEventListener("click", () => {
  const entry = readForm();
  if (!entry.name.trim()) {
    say("食べたものを入れてください");
    $("name").focus();
    return;
  }
  if (ui.editing) {
    updateLog(state, ui.editing, entry);
    say(`✏️ 「${entry.name.trim()}」を直しました`);
    ui.editing = null;
  } else {
    ui.justAdded = addLog(state, entry).id;
    say(`🍚 ${label(ui.date)} の${ui.meal}に「${entry.name.trim()}」を記録しました ↓`);
  }
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

function renderDay() {
  const logs = logsOf(state, ui.date);
  const t = totals(logs);
  const g = state.targets;
  const off = dayOffset();
  $("dayHeading").textContent = off === 0 ? "きょうのしょくじ" : off === -1 ? "きのうのしょくじ" : `${label(ui.date)}のしょくじ`;

  if (!logs.length) {
    $("totals").innerHTML = "";
    $("dayList").innerHTML = '<div class="ls-empty"><span class="ls-empty-icon" aria-hidden="true">🍙</span>まだ記録がありません。上で食べたものを入れてみましょう</div>';
  } else {
    const missing = t.count - t.withKcal;
    // PFC は、入れた品がある日だけ出す（入れていないのに「0 g」と出ると、食べていないように見えるため）
    const hasPfc = logs.some((l) => l.p != null || l.f != null || l.c != null);
    $("totals").innerHTML = `
      <div class="kcal-line"><b>${fmt(t.kcal)}<small>kcal</small></b><span>目標 ${fmt(g.kcal)} kcal（${pct(t.kcal, g.kcal)}%）</span></div>
      <div class="bar${t.kcal > g.kcal ? " over" : ""}"><i style="width:${pct(t.kcal, g.kcal)}%"></i></div>
      ${!hasPfc ? "" : `<div class="pfc">
        ${[["p", "たんぱく質"], ["f", "脂質"], ["c", "炭水化物"]]
          .map(([k, name]) => `<div class="${k}">${name}<b>${fmt(t[k])}<small> / ${fmt(g[k])}g</small></b><span class="bar"><i style="width:${pct(t[k], g[k])}%"></i></span></div>`)
          .join("")}
      </div>`}
      ${missing ? `<p class="note">※ カロリーを入れていないものが ${missing} 件あります（合計に入っていません）</p>` : ""}`;
    $("dayList").innerHTML = MEALS.map((meal) => {
      const items = logs.filter((l) => l.meal === meal);
      if (!items.length) return "";
      return `<div class="meal-group"><span class="meal-tag">${meal}</span><div class="items">${items
        .map(
          (l) => `<div class="item${l.id === ui.editing ? " is-editing" : ""}${l.id === ui.justAdded ? " is-new" : ""}">
            <button class="name" type="button" data-edit="${l.id}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <button class="del" type="button" data-del="${l.id}" aria-label="${esc(l.name)} を消す">✕</button>
          </div>`
        )
        .join("")}</div></div>`;
    }).join("") + '<p class="edit-hint">名前を押すと直せます</p>';
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
  const n = streak(state, today);
  $("streak").innerHTML = n ? `🔥 <b>${n}</b> 日つづけて記録しています` : "記録した日が続くと、ここに日数が出ます";
  const days = week(state, today);
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
  const top5 = menus(state).slice(0, 5);
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
    const v = Number($(id).value);
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
    } catch {
      // やめたときは何もしない
      return;
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
  state = reset();
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
