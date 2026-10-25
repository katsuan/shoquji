// テストの前に、Q キットの共通の部品（q-oqrn の shared/botlink.js）を読んで window.QBotLink の代わりに置く
// （ページでは index.html の <script> で読む。テストは同じ GitHub フォルダにある q-oqrn を読む）
import { createRequire } from "node:module";
globalThis.QBotLink = createRequire(import.meta.url)("../../q-oqrn/shared/botlink.js");
