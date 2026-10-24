// 「📱 LINE 版で使う」：ブラウザで開いたときの「LINEで開く」の案内と、4コマの使い方（最初だけ。閉じたら出さない）。つづくと同じ作り
//   「⚙️ 食事記録ボットとつなぐ」の「👀 使い方（4コマ）を見る」で、また出る（LINE 版でも）
import { $, esc } from "./dom.js?v=202610250700";

const BANNER_KEY = "shoquji:lineBannerOff"; // この端末で閉じたか（設定なので端末に残してよい）

export function initLineGuide({ inside, openUrl, say }) {
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
    const shown = window.LineShareLiff?.outsideHelp?.($("lineOutside"), { appUrl: () => openUrl, canLogin: false });
    if (!shown) $("lineOutside").innerHTML = `<a class="ls-button line is-block" href="${esc(openUrl)}">📱 LINE 版で開く</a>`;
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
      say("案内を閉じました（「⚙️ 食事記録ボットとつなぐ」からまた見られます）");
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
}
