// 「カードで送る」のカード（おくるんのお知らせカード。line-share の shared/oqrn.js）と、くらぶボットが読む記録用の文字
// app.js が読む（「カードで送る」のリンクを作るとき）
import { MEALS } from "./store.js?v=202610291713";
import { fmt, label } from "./stats.js?v=202610291713";

const PAGE_URL = "https://katsuan.github.io/shoquji/";
const CARD_COLOR = "#EC8A16"; // ロゴの玉子焼きの黄色

// 中身は食事ごとの名前と合計。sendText なら、カードの後ろに記録用の文字も1通つける
export function cardUrl(date, logs, t, { sendText = false } = {}) {
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
  if (sendText) params.set("sendText", recordText(date, logs));
  return window.OQRN ? window.OQRN.cardUrl(params) : "#";
}

// 記録用の文字（くらぶボットが読む形。line-meal-project の 3_usecase.shoquji.gs）
//   #しょくじ 2026/10/22
//   朝 トースト 250kcal P8 F6 C40
function recordText(date, logs) {
  const lines = logs.map((l) => {
    const nums = [l.kcal != null ? `${l.kcal}kcal` : "", l.p != null ? `P${l.p}` : "", l.f != null ? `F${l.f}` : "", l.c != null ? `C${l.c}` : ""].filter(Boolean);
    return [l.meal, l.name.replace(/\s+/g, " "), ...nums].join(" ");
  });
  return [`#しょくじ ${date.replace(/-/g, "/")}`, ...lines].join("\n");
}
