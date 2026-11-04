// 画面の部品を id で取る（$）と、HTML に入れる文字を安全にする（esc）、Q キットの線アイコン（icon）。app.js と js/*.js で使う

// id で画面の部品を取る
export const $ = (id) => document.getElementById(id);
// HTML に入れる文字の & < > " ' を書きかえて、安全にする
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Q キットの線アイコン（ui.css の ls-icon。名前は q-oqrn の shared/kit.html の一覧）。HTML の文字で返す
export const icon = (name) => `<span class="ls-icon" data-icon="${esc(name)}" aria-hidden="true"></span>`;
