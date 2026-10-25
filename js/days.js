// ほかの Q ツール（つづく）が読む、記録がある日の一覧
// 同じサイト（katsuan.github.io）の同じブラウザなら、つづくが読んで「しょくじ連動」の習慣に ○ を付ける。
// 端末の記録に加えて、くらぶボットで入れた記録の日も入れる（ボットの記録は端末の記録ではないので、shoquji:v1 だけでは見えない）
// 形：{ v: 1, days: ["YYYY-MM-DD", …] }（古い日から。中身は日付だけ）
// app.js が読む（描きなおすたびに writeDays）
const DAYS_KEY = "shoquji:days";
let written = "";

// 記録がある日の一覧を shoquji:days に書く（変わったときだけ。つづくが読む）
export function writeDays(logs) {
  const days = [...new Set(logs.map((l) => l.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const text = JSON.stringify({ v: 1, days });
  if (text === written) return; // 変わったときだけ書く
  written = text;
  try {
    localStorage.setItem(DAYS_KEY, text);
  } catch {
    // 残せなくても、しょくじは使える
  }
}
