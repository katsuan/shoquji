// LINE の中（LIFF）で開いたときだけ、食事記録ボット（line-meal-project の GAS）とつなぐ
// - 記録した品を、ボットのシートにも1行ずつ入れる。開いたときに、ボットで入れた記録（トークで送ったものなど）を読む
// - ボットに送るのは LIFF の ID トークンだけ（だれかはボット側が LINE に確かめる）。トークンは端末に残さない（W7）
// - つなぐ先は、使う人が自分で入れた GAS の URL だけ（URL の ?〜 からは受けとらない。W5・W9）
// - ブラウザで開いたとき・設定が空のときは何もしない（しょくじは今までどおり端末の中だけ）
// - つくりは、つづく（q-tuzuq）の js/linelog.js を写したもの。ボット側の受け口は line-meal-project の 6_web/6_webapp.gs
//   （submitMealBatch・listMealLogs）
import { LINE_LOG } from "./line-config.js?v=202610250400";

const SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";
const TIMEOUT_MS = 15000;
const GAS = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,120}\/exec$/;
// つなぐ GAS の URL の形（ちがえば ""）
export const cleanGasUrl = (v) => (GAS.test(String(v ?? "").trim()) ? String(v).trim() : "");

// LINE のアプリの中か（ブラウザでは LIFF の SDK も読まない）
export const inLineApp = (ua = globalThis.navigator?.userAgent || "") => /\bLine\//i.test(ua);

function loadSdk() {
  if (window.liff) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.charset = "utf-8";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("sdk"));
    document.head.append(s);
  });
}

/**
 * つなげるときは { record, list } を、つなげないときは null を返す
 * - LINE のアプリの中で、LIFF として開き、ログインしているときだけ
 */
export async function startLineLog(gasUrl, config = LINE_LOG) {
  const liffId = String(config?.liffId || "");
  if (!liffId || !cleanGasUrl(gasUrl) || !inLineApp()) return null;
  try {
    await loadSdk();
    await Promise.race([liff.init({ liffId }), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 10000))]);
    if (!liff.isInClient() || !liff.isLoggedIn()) return null;
  } catch (error) {
    console.error(error);
    return null;
  }
  return makeClient(gasUrl, () => {
    try {
      return liff.getIDToken() || "";
    } catch {
      return "";
    }
  });
}

// ボットのやさしい文の失敗を、短い印に（claim：持ち主の登録を受けつけた／guest：このボットをまだ使っていない人／auth：開きなおす／denied：許可待ち・停止／fail：そのほか）
function errorCode(text) {
  const t = String(text || "");
  if (/adoptShoqujiOwner/.test(t)) return "claim";
  if (/まだ使っていません/.test(t)) return "guest";
  if (/開きなおして|本人確認/.test(t)) return "auth";
  if (/許可待ち|停止|使えません/.test(t)) return "denied";
  return "fail";
}

// しょくじの食事の名前 ⇄ ボットの食事の名前（ボットは「間食」を「その他」と書く）
export const toBotMeal = (meal) => (meal === "間食" ? "その他" : meal);
export const fromBotMeal = (meal) => (["朝", "昼", "夜"].includes(meal) ? meal : "間食");

/**
 * ボットへの呼び出し（テストでは fetch と ID トークンを差しかえる）
 * 返事は { ok, ... } か { ok: false, error }（error：claim・guest・auth・denied・fail・net）
 */
export function makeClient(gasUrl, getIdToken, fetchImpl = (...a) => fetch(...a)) {
  async function post(body, keepalive = false) {
    const idToken = getIdToken();
    if (!idToken) return { ok: false, error: "auth" };
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // text/plain なら、GAS に前もっての問い合わせ（preflight）がいらない
      const res = await fetchImpl(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ idToken, ...body }),
        keepalive,
        signal: ctrl?.signal
      });
      const json = await res.json();
      if (!json || typeof json !== "object") return { ok: false, error: "net" };
      return json.ok ? json : { ok: false, error: errorCode(json.error) };
    } catch {
      return { ok: false, error: "net" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    // しょくじの記録（{ id, date, meal, name, kcal, p, f, c }）を、ボットに入れる。同じ id は何度送っても1回だけ入る
    record: (logs, keepalive) =>
      post(
        {
          action: "submitMealBatch",
          source: "shoquji",
          dedupe: false,
          sendLineSummary: false,
          items: logs.slice(0, 30).map((l) => ({ clientId: l.id, mealDate: l.date, meal: toBotMeal(l.meal), menu: l.name, kcal: l.kcal, protein: l.p, fat: l.f, carb: l.c }))
        },
        keepalive
      ),
    // from〜to（YYYY-MM-DD）にボットに入っている記録
    list: (from, to) => post({ action: "listMealLogs", from, to }),
    // ボットに入っている記録（logId）を直す（カロリーは要る）。MYメニューにも保存する（前の食事記録の画面と同じ）
    update: (logId, e) =>
      post({ action: "updateMealLog", source: "shoquji", logId, mealDate: e.date, meal: toBotMeal(e.meal), menu: e.name, kcal: e.kcal, protein: e.p, fat: e.f, carb: e.c, saveToMaster: true, sendLineSummary: false }),
    // しょくじで直した自分の記録（id＝clientId）を、ボットにもそろえる（カロリーがなくてもよい。MYメニューには触らない）
    updateOwn: (l) =>
      post({ action: "updateMealLog", source: "shoquji", clientId: l.id, allowPending: true, mealDate: l.date, meal: toBotMeal(l.meal), menu: l.name, kcal: l.kcal, protein: l.p, fat: l.f, carb: l.c, saveToMaster: false, sendLineSummary: false }),
    // しょくじで消した自分の記録（id）を、ボットからも消す。ボットにないときも ok
    removeOwn: (id, keepalive) => post({ action: "deleteMealLog", source: "shoquji", clientId: id }, keepalive),
    // ボットの記録（logId）を消す
    removeBot: (logId, keepalive) => post({ action: "deleteMealLog", source: "shoquji", logId }, keepalive),
    // 開いたときの中身（目標・20時のお知らせ・よく記録するもの・MYメニュー・「⚡ よく記録」のメニューの状態）
    state: () => post({ action: "getLiffAppState", source: "shoquji" }),
    // 目標・お知らせ・よく記録するものの固定（送った項目だけ直る）。richMenu：{ image, items, key } で「⚡ よく記録」を作りなおす
    profile: (patch) => post({ action: "updateProfile", source: "shoquji", ...patch }),
    // MYメニュー（ボットの栄養の表）だけを保存する。masterKey があればその品を直す
    //   keep：しょくじにない項目（種類・量・メモ・塩分・食物繊維）。前の値をそのまま送る（送らないと消える）
    saveMaster: (masterKey, e, keep = {}) =>
      post({ action: "saveNutritionMasterOnly", source: "shoquji", masterKey: masterKey || "", menu: e.name, kcal: e.kcal, protein: e.p, fat: e.f, carb: e.c, flavor: keep.flavor || "", unit: keep.unit || "", note: keep.note || "", salt: keep.salt ?? null, fiber: keep.fiber ?? null })
  };
}

// ボットの記録を、しょくじの記録の形に（しょくじから送った記録・消した記録は出さない）。読むだけで、端末の記録には足さない
export function botLogsForView(botLogs, localLogs, deleted = []) {
  const mine = new Set([...localLogs.map((l) => l.id), ...deleted]);
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return (Array.isArray(botLogs) ? botLogs : [])
    .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) && String(b.menu || "").trim() && !(b.clientId && mine.has(b.clientId)))
    .map((b) => ({
      id: `bot-${String(b.logId || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40)}`,
      logId: String(b.logId || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60),
      date: b.date,
      meal: fromBotMeal(b.meal),
      name: String(b.menu).trim().slice(0, 40),
      kcal: num(b.kcal),
      p: num(b.protein),
      f: num(b.fat),
      c: num(b.carb),
      bot: true
    }));
}

// しょくじから送った記録（clientId つき）と、ボットの行をくらべて、そろえ方を決める
// - しょくじで消した記録がボットに残っていれば、ボットから消す（remove）
// - 中身がちがえば、あとから直したほう（しょくじは upd、ボットは updatedAt）にそろえる：しょくじが新しければボットを直す（push）、
//   ボットが新しければ（トークでカロリーを入れたなど）しょくじを直す（pull）
// - skip：いま「元に戻す」を待っている記録の id（まだボットに送らない）
export function planSync(botLogs, localLogs, deleted = [], skip = new Set()) {
  const local = new Map(localLogs.map((l) => [l.id, l]));
  const gone = new Set(deleted);
  const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const plan = { push: [], pull: [], remove: [] };
  (Array.isArray(botLogs) ? botLogs : []).forEach((b) => {
    const id = String(b?.clientId || "");
    if (!id || skip.has(id)) return;
    if (gone.has(id) && !local.has(id)) return void plan.remove.push(id);
    const l = local.get(id);
    if (!l) return; // ほかの端末のしょくじの記録など：さわらない
    const fromBot = { date: b.date, meal: fromBotMeal(b.meal), name: String(b.menu || "").trim().slice(0, 40), kcal: n(b.kcal), p: n(b.protein), f: n(b.fat), c: n(b.carb) };
    const same = fromBot.date === l.date && fromBot.meal === l.meal && fromBot.name === l.name && ["kcal", "p", "f", "c"].every((k) => fromBot[k] === n(l[k]));
    if (same) return;
    if (Number(b.updatedAt || 0) > Number(l.upd || 0)) plan.pull.push({ id, entry: fromBot });
    else plan.push.push(l);
  });
  plan.push = plan.push.slice(0, 30);
  plan.remove = plan.remove.slice(0, 30);
  return plan;
}

// 失敗したときに出す、やさしい言葉（E2：仕組みの言葉は出さない）
export function lineLogMessage(error) {
  if (error === "auth") return "食事記録ボットに入れられませんでした。LINE で、しょくじを開きなおしてね";
  if (error === "claim") return "つなぎ先の GAS に、持ち主の登録を受けつけました。10分以内に、GAS エディタで adoptShoqujiOwner を実行してね";
  if (error === "denied") return "食事記録ボットに入れられませんでした。つなぎ先の持ち主の許可が要ります（記録はこの端末に残っています）";
  return "食事記録ボットに入れられませんでした。記録はこの端末に残っています";
}
