// くらぶボット（LINE の中でつないだとき）の設定と、よく記録するもの
//   - 開いたときに1回、ボットの目標・20時のお知らせ・よく記録するもの・MYメニューを読む（readProfile）。目標はボットにそろえる
//   - 目標・お知らせ・よく記録するものの固定を、ボットにも送る（saveProfile）
//   - 「📌 よく記録するもの・MYメニュー」の欄：固定と並べかえ、MYメニューをさがして直す
// 画面の残り（記録・一覧など）とは、initBotMenu で受けとる ctx でつなぐ
// app.js が読む（initBotMenu を1回）。js/botlink.js も、つないだときに readProfile・resetProfile を使う
import { fmt } from "./stats.js?v=202610281201";
import { lineLogMessage } from "./linelog.js?v=202610281201";
import { $, esc } from "./dom.js?v=202610281201";


// MYメニューの名前（種類・量つき）
export const dn = (m) => String(m.displayName || [m.menu || m.name, m.flavor, m.unit].filter(Boolean).join(" ")).trim();

let ctx = null; // { lineLog(), state(), ui, link, render, persist, say, startMasterEdit }
let profile = null; // ボットの { user, quickMenus, popularMenus, menus, isAdmin }（つないだあと、開いたときに読む）
let pins = null; // 並べかえ中の固定（MYメニューの masterKey）。null のあいだは保存してある並び

// ボットから読んだ設定（目標・お知らせ・よく記録するもの・MYメニュー。まだなら null）
export const getProfile = () => profile;
// ボットの設定を忘れる（つなげなかった・まだ使っていない人のとき）
export const resetProfile = () => {
  profile = null;
  pins = null;
};

// 開いたときに1回：ボットの目標・お知らせ・よく記録するもの・MYメニューを読む
export async function readProfile() {
  if (!ctx.lineLog()) return;
  const res = await ctx.lineLog().state();
  if (!res.ok) return; // 読めなくても、記録はできる（失敗の知らせは記録を読むほうで出す）
  const d = res.dashboard || {};
  profile = { user: d.user || {}, quickMenus: d.quickMenus || [], popularMenus: d.popularMenus || [], menus: res.menus || [], isAdmin: res.permission?.isAdmin === true };
  // 目標カロリーは、ボットのものにそろえる
  const target = Number(profile.user.calorieTarget) || 0;
  if (target > 0 && target !== ctx.state().targets.kcal) {
    ctx.state().targets.kcal = Math.round(target);
    ctx.persist();
  }
  $("botNotify").checked = profile.user.notify === true;
  ctx.render();
  renderPins();
  if (ctx.link.mode === "quick" && !ctx.link.usedQuick) {
    ctx.link.usedQuick = true;
    $("quickFold").open = true;
    $("quickFold").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// 目標・お知らせを、ボットにも（送った項目だけ直る）
export async function saveProfile(patch, doneText) {
  if (!ctx.lineLog()) return;
  const res = await ctx.lineLog().profile(patch);
  if (!res.ok) return ctx.say(lineLogMessage(res.error));
  if (res.dashboard) profile = { ...profile, user: res.dashboard.user || profile.user, quickMenus: res.dashboard.quickMenus || profile.quickMenus, popularMenus: res.dashboard.popularMenus || profile.popularMenus };
  if (doneText) ctx.say(doneText);
  return res;
}

// ボットに保存してある固定の並び（masterKey の一覧）
const savedPins = () => (profile ? profile.quickMenus.filter((m) => m.pinned && m.masterKey).map((m) => m.masterKey) : []);
// masterKey から MYメニュー・よく記録するものを引ける Map
export const byKey = () => new Map([...(profile?.menus || []), ...(profile?.quickMenus || [])].filter((m) => m.masterKey).map((m) => [m.masterKey, m]));

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
        (m) => `<div class="cand-row"><span class="pin-name"><i class="scope-tag${m.scope === "common" ? " is-common" : ""}">${m.scope === "common" ? "共通" : "自分"}</i>${esc(dn(m))}${m.kcal != null ? `<small>${fmt(m.kcal)} kcal</small>` : ""}</span>
          <button class="ls-button is-small" type="button" data-pin-add="${esc(m.masterKey)}">📌 固定</button>
          <button class="ls-button is-small" type="button" data-master-edit="${esc(m.masterKey)}">${m.scope === "common" && !profile.isAdmin ? "✏️ 自分用に" : "✏️ 直す"}</button></div>`
      )
      .join("") || (q ? '<p class="ls-hint">見つかりません。MYメニューにある品だけ出ます。</p>' : "");
}

// ボットの設定と、よく記録するもの・MYメニューの欄のボタンをつなぐ（app.js から1回）
export function initBotMenu(context) {
  ctx = context;
  $("botNotify").addEventListener("change", (e) => saveProfile({ notify: e.target.checked }, e.target.checked ? "🔔 20時のお知らせをオンにしました" : "20時のお知らせをオフにしました"));
  $("quickFold").addEventListener("toggle", renderPins);
  $("pinSearch").addEventListener("input", renderPins);
  $("quickFold").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-master-edit]");
    if (edit) return ctx.startMasterEdit(edit.dataset.masterEdit);
    const list = [...(pins || savedPins())];
    const add = e.target.closest("[data-pin-add]");
    const del = e.target.closest("[data-pin-del]");
    const move = e.target.closest("[data-pin-move]");
    if (add) {
      if (list.length >= 12) return ctx.say("固定できるのは 12 品までです");
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
    if (!ctx.lineLog() || !profile) return;
    const list = pins || savedPins();
    $("savePins").disabled = true;
    $("savePins").textContent = "保存中…";
    try {
      const res = await saveProfile({ favorites: list });
      if (res) {
        // 返事に新しい並びがないときも、画面は保存した並びに
        if (!res.dashboard && profile) {
          const map = byKey();
          profile.quickMenus = [...list.map((k) => ({ ...map.get(k), pinned: true })), ...profile.quickMenus.filter((m) => !list.includes(m.masterKey)).map((m) => ({ ...m, pinned: false }))];
        }
        pins = null;
        ctx.say("📌 よく記録するものの並びを保存しました");
      }
    } finally {
      $("savePins").disabled = false;
      $("savePins").textContent = "📌 この並びで保存";
      renderPins();
    }
  });
}
