// 画面の部品を id で取る（$）と、HTML に入れる文字を安全にする（esc）。app.js と js/*.js で使う
export const $ = (id) => document.getElementById(id);
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
