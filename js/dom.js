// 画面の部品を id で取る（$）と、HTML に入れる文字を安全にする（esc）。app.js と js/*.js で使う

// id で画面の部品を取る
export const $ = (id) => document.getElementById(id);
// HTML に入れる文字の & < > " ' を書きかえて、安全にする
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
