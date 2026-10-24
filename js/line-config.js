// LINE の中（LIFF）で開いたしょくじを、食事記録ボット（line-meal-project の GAS）とつなぐための設定。
// LIFF の ID は画面に置く前提のもの（W10）。鍵・合言葉はここに置かない。
// 自分の GAS につなぐ人は、しょくじの「⚙️ LINE とつなぐ」に URL を入れる（入れなければ、下の gasUrl につながる）。
//   liffId：しょくじの LIFF の ID。食事記録ボットの LIFF（エンドポイント URL を https://katsuan.github.io/shoquji/ にしたもの）。
//          ボットのカード・リッチメニューの「画面で入力」もここが開く（?mode=…&meal=… を app.js の openFromLink で受ける）
// liffId が空のあいだは、LINE の中で開いても今までどおり（端末の中だけ）。
//   gasUrl：この LIFF で開いたときに、何も入れなくてもつながる食事記録ボットの GAS（ボットの持ち主のもの。秘密ではない）。
//          「⚙️ LINE とつなぐ」に自分の GAS の URL を入れた人は、そちらにつながる
export const LINE_LOG = {
  liffId: "2010088825-CulmmaFc",
  gasUrl: "https://script.google.com/macros/s/AKfycby44a0PmVW3aaTUOw-hWEkOZQzCcvQqOTFAx4uchy5WcQK1K2WjkvCof90VK7ADSqIc/exec"
};

// しょくじを LINE の中（LIFF）で開く URL（LIFF ID がまだないときは、ふつうのページ）
export const OPEN_URL = LINE_LOG.liffId ? `https://liff.line.me/${LINE_LOG.liffId}` : "https://katsuan.github.io/shoquji/";
