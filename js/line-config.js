// LINE の中（LIFF）で開いたしょくじを、くらぶボット（katsuan/qlove-bot の 🍚 しょくじ。前のくらぶボットが合流したもの）とつなぐための設定。
// LIFF の ID は画面に置く前提のもの（W10）。鍵・合言葉はここに置かない。
// 自分の GAS につなぐ人は、しょくじの「⚙️ くらぶボットとつなぐ」に URL を入れる（入れなければ、下の gasUrl につながる）。
//   liffId：しょくじの LIFF の ID。くらぶボットの LIFF（エンドポイント URL を https://katsuan.github.io/shoquji/ にしたもの）。
//          ボットのカード・リッチメニューの「画面で入力」もここが開く（?mode=…&meal=… を app.js の openFromLink で受ける）
// liffId が空のあいだは、LINE の中で開いても今までどおり（端末の中だけ）。
//   gasUrl：この LIFF で開いたときに、何も入れなくてもつながる くらぶボットの GAS（ボットの持ち主のもの。秘密ではない）。
//          2026-10-25 に、前のくらぶボット（AKfycby44a0P…。いまは「引っこしました」と返すだけ）から付けかえた
//          「⚙️ くらぶボットとつなぐ」に自分の GAS の URL を入れた人は、そちらにつながる
// js/botlink.js・js/linelog.js・app.js が読む
export const LINE_LOG = {
  liffId: "2010088825-CulmmaFc",
  gasUrl: "https://script.google.com/macros/s/AKfycbyZwDlGzlZzy35czwMM5kB7gRiZZC3_CslS8JYo6BD_sBPYRoevADmwCwTQzZaJnYeraw/exec"
};

// しょくじを LINE の中（LIFF）で開く URL（LIFF ID がまだないときは、ふつうのページ）
export const OPEN_URL = LINE_LOG.liffId ? `https://liff.line.me/${LINE_LOG.liffId}` : "https://katsuan.github.io/shoquji/";
