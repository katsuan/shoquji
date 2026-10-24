// LINE の中（LIFF）で開いたしょくじを、食事記録ボット（line-meal-project の GAS）とつなぐための設定。
// LIFF の ID は画面に置く前提のもの（W10）。鍵・合言葉はここに置かない。
// つなぐ GAS の URL は、使う人がそれぞれ、しょくじの「⚙️ LINE とつなぐ」に入れる（ここには置かない）。
//   liffId：しょくじの LIFF の ID。食事記録ボットと「同じ LINE ログインのチャネル」に作る
//          （ちがうチャネルだと、ボットが本人を確かめられず、ボットの記録とも同じ人にならない）。
//          エンドポイント URL は https://katsuan.github.io/shoquji/ 、scope は openid と profile。
// 空のあいだは、LINE の中で開いても今までどおり（端末の中だけ）。
export const LINE_LOG = {
  liffId: ""
};

// しょくじを LINE の中（LIFF）で開く URL（LIFF ID がまだないときは、ふつうのページ）
export const OPEN_URL = LINE_LOG.liffId ? `https://liff.line.me/${LINE_LOG.liffId}` : "https://katsuan.github.io/shoquji/";
