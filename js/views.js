// しょくじ：画面に出す中身（HTML の文字）を作る。画面にはさわらない（入れるのは app.js）。テストは test/views.test.mjs
//   この日のしょくじ（合計・目標のバー・食事ごとの割合・PFC・一覧）、ふりかえりの1週間、だいたいのカロリー（ご飯◯杯分）、入力欄の見出しとボタンの言葉
import { MEALS } from "./store.js?v=202611012034";
import { byMeal, fmt, label } from "./stats.js?v=202611012034";
import { esc, icon } from "./dom.js?v=202611012034";

// 朝・昼・夜・間食の色（style.css の .m0〜.m3。朝＝黄・昼＝緑・夜＝藍・間食＝ピンク）
export function mealClass(meal) {
  return `m${Math.max(0, MEALS.indexOf(meal))}`;
}

// 目標にしめる割合（%。100 まで。目標がなければ 0）
export function pct(v, goal) {
  return goal > 0 ? Math.min(100, Math.round((v / goal) * 100)) : 0;
}

// 食事ごとの色のバー（横）。rows は byMeal の形。scale はバーの右はしにあたるカロリー
export function mealBarHtml(rows, scale, { over = false, goal = 0 } = {}) {
  const segs = rows
    .filter((r) => r.kcal > 0)
    .map((r) => `<i class="${mealClass(r.meal)}" style="width:${(r.kcal / scale) * 100}%" title="${r.meal} ${fmt(r.kcal)} kcal"></i>`)
    .join("");
  // 目標をこえた日は、目標のところに線
  const mark = over && goal > 0 ? `<span class="goal-mark" style="left:${(goal / scale) * 100}%" aria-hidden="true"></span>` : "";
  return `<div class="bar stack${over ? " over" : ""}">${segs}${mark}</div>`;
}

// 食事ごとの割合とカロリーを、入力欄のタブと同じ朝・昼・夜・間食の横並びで（1つずつ「朝 16%」「平均 215 kcal」の2行）。
// 記録のない食事も薄く出す（どれがないかわかるように）。avgDays を渡すと「1日平均」も。カロリーがひとつもなければ ""
export function mealSplitHtml(rows, avgDays = 0) {
  if (!rows.some((r) => r.kcal > 0)) return "";
  return `<ul class="meal-split">${rows
    .map((r) => {
      const kcal = avgDays ? Math.round(r.kcal / avgDays) : r.kcal;
      const zero = r.kcal > 0 ? "" : " is-zero";
      return `<li class="${mealClass(r.meal)}${zero}"><span class="name">${r.meal}<b>${r.pct}%</b></span>${avgDays ? `<small>平均</small>` : ""}<small>${fmt(kcal)} kcal</small></li>`;
    })
    .join("")}</ul>`;
}

// 合計カロリーと目標のバー（朝・昼・夜・間食の色で積む）と、食事ごとの割合、PFC。t は totals(logs)、g は目標
export function totalsHtml(logs, t, g) {
  const missing = t.count - t.withKcal;
  // PFC は、入れた品がある日だけ出す（入れていないのに「0 g」と出ると、食べていないように見えるため）
  const hasPfc = logs.some((l) => l.p != null || l.f != null || l.c != null);
  const pfc = [["p", "たんぱく質"], ["f", "脂質"], ["c", "炭水化物"]]
    .map(([k, name]) => `<div class="${k}">${name}<b>${fmt(t[k])}<small> / ${fmt(g[k])}g</small></b><span class="bar"><i style="width:${pct(t[k], g[k])}%"></i></span></div>`)
    .join("");
  const meals = byMeal(logs);
  return `
      <div class="kcal-line"><b>${fmt(t.kcal)}<small>kcal</small></b><span>目標 ${fmt(g.kcal)} kcal（${pct(t.kcal, g.kcal)}%）</span></div>
      ${mealBarHtml(meals, Math.max(g.kcal, t.kcal, 1), { over: t.kcal > g.kcal, goal: g.kcal })}
      ${mealSplitHtml(meals)}
      ${hasPfc ? `<div class="pfc">
        ${pfc}
      </div>` : ""}
      ${missing ? `<p class="note">※ カロリーを入れていないものが ${missing} 件あります（合計に入っていません）</p>` : ""}`;
}

// 一覧の1品（名前を押すと直す、× で消す）。
//   opts：{ editing（直している記録の id）, justAdded（記録したばかりの id）, botEdit（直しているボットの記録の logId）, botLinked（くらぶボットとつないでいるか） }
export function itemHtml(l, { editing = null, justAdded = null, botEdit = null, botLinked = false } = {}) {
  // ボットで入れた記録：消すのはトークで。直すのは、つないでいるときだけ
  if (l.bot) {
    // LINE の中でつないでいるときは、押すと直せる（ボットの記録を直す）
    const name = botLinked
      ? `<button class="name" type="button" data-bot-edit="${esc(l.logId)}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>`
      : `<span class="bot-name">${esc(l.name)}</span>`;
    return `<div class="item is-bot${l.logId === botEdit ? " is-editing" : ""}">
            ${name}
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <span class="bot-tag" title="くらぶボットで入れた記録">ボット</span>
            ${botLinked ? `<button class="del" type="button" data-bot-del="${esc(l.logId)}" aria-label="${esc(l.name)} を消す">${icon("close")}</button>` : ""}
          </div>`;
  }
  return `<div class="item${l.id === editing ? " is-editing" : ""}${l.id === justAdded ? " is-new" : ""}">
            <button class="name" type="button" data-edit="${esc(l.id)}" aria-label="${esc(l.name)} を直す">${esc(l.name)}</button>
            <span class="kc">${l.kcal != null ? `${fmt(l.kcal)} kcal` : ""}</span>
            <button class="del" type="button" data-del="${esc(l.id)}" aria-label="${esc(l.name)} を消す">${icon("close")}</button>
          </div>`;
}

// その日の記録を、食事ごとのまとまりにする（記録のない食事は出さない）。opts は itemHtml と同じ
export function dayListHtml(logs, opts = {}) {
  return MEALS.map((meal) => {
    const items = logs.filter((l) => l.meal === meal);
    if (!items.length) return "";
    return `<div class="meal-group"><span class="meal-tag ${mealClass(meal)}">${meal}</span><div class="items">${items.map((l) => itemHtml(l, opts)).join("")}</div></div>`;
  }).join("");
}

// 見ている週の呼び方（0＝今週、-1＝先週、それより前＝この週）
export function weekName(offset) {
  return offset === 0 ? "今週" : offset === -1 ? "先週" : "この週";
}

// 「10/20〜10/26」の形
export function rangeLabel(from, to) {
  const md = (d) => d.split("-").slice(1).map(Number).join("/");
  return `${md(from)}〜${md(to)}`;
}

// 1週間の棒（日ごとに、朝・昼・夜・間食の色を下から積む）と目標の線。days は stats.js の week の形
// 縦は 数字（14px）・棒（110px）・日付・曜日 の段。目標の線は棒の段（上から 16px〜126px）の中の高さに置く
export function weekHtml(days, { today, goal }) {
  const top = Math.max(goal * 1.2, ...days.map((d) => d.kcal), 1);
  return (
    `<div class="goal" style="top:${16 + 110 * (1 - goal / top)}px"><span>目標 ${fmt(goal)}</span></div>` +
    days
      .map((d) => {
        const [y, m, dd] = d.date.split("-").map(Number);
        const segs = d.meals
          .filter((r) => r.kcal > 0)
          .map((r) => `<i class="${mealClass(r.meal)}" style="flex-grow:${r.kcal}"></i>`)
          .join("");
        const dow = "日月火水木金土"[new Date(y, m - 1, dd).getDay()];
        return `<div class="day-col${d.date === today ? " today" : ""}${d.future ? " future" : ""}"><span class="v">${d.kcal ? fmt(d.kcal) : ""}</span><span class="col"><span class="stack" style="height:${(d.kcal / top) * 100}%">${segs}</span></span><span>${m}/${dd}</span><span class="dow">${dow}</span></div>`;
      })
      .join("")
  );
}

// だいたいのカロリー（ご飯◯杯分）。くらぶボットと同じ目安：ご飯1杯（150g）≈ 240kcal。朝・昼・夜は½〜3杯、間食は「少し」〜1.5杯
export const RICE_BOWL_KCAL = 240;
export function estOptions(meal) {
  const bowls = meal === "間食" ? [{ key: "few", label: "少し", kcal: 80 }, 0.5, 1, 1.5] : [0.5, 1, 1.5, 2, 3];
  return bowls.map((b) => (typeof b === "object" ? b : { key: String(b), label: `${b === 0.5 ? "½" : b}杯`, kcal: Math.round(RICE_BOWL_KCAL * b) }));
}

// 入力欄の見出しと、保存のボタン（線アイコンの名前と言葉）。ui は app.js の ui、dayOffset は きょう 0・きのう -1・ほか null
export function formTexts(ui, dayOffset) {
  const heading = ui.botEdit
    ? "ボットの記録を直す"
    : ui.masterEdit
      ? ui.masterEdit.toMine ? "共通の MYメニューを自分用にする" : "MYメニューを直す"
      : ui.editing ? "記録を直す" : `記録する（${dayOffset === 0 ? "きょう" : label(ui.date)}）`;
  const [saveIcon, saveText] = ui.masterEdit
    ? ["save", ui.masterEdit.toMine ? "自分用に保存" : "MYメニューに保存"]
    : ui.editing || ui.botEdit ? ["edit", "直す"] : ["add", "記録する"];
  return { heading, saveIcon, saveText };
}
