// くらぶボットのカード・リッチメニューから開いたとき（?mode=input|logs|summary|quick&meal=…&menu=…&mealDate=…&logId=…）の指定を読む
// LINE の中では LIFF が ?〜 に戻して届く。ブラウザで liff.line.me を開いたときは liff.state に入って届く
// 受けるのは、日付・食事・名前・数字・どこを見るかだけ（つなぎ先などは受けとらない。W5）
// app.js が読む（開いたときに1回）
import { MEALS, num } from "./store.js?v=202610262000";
import { addDays, ymd } from "./stats.js?v=202610262000";

// 開いた URL（LINE では liff.state の中）から、ボットのカード・メニューの指定を読む
export function readLink(href = location.href) {
  const url = new URL(href);
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
