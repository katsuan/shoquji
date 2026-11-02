// 読みこみの印（?v=…）が、どのファイルでもそろっているか（そろわないと、古い部品と新しい部品がまざって画面が出なくなる）
//   印は公開のとき（GitHub Actions。Q 共通の q-pages.yml）に新しい番号に付け直すので、ファイルを変えても手で上げなくてよい
import "./_botlink.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { cwd: new URL("..", import.meta.url), encoding: "utf8" }).trim();
const versions = (text) => [...new Set([...text.matchAll(/\?v=(\d{8,})/g)].map((m) => m[1]))];

test("読みこみの印は、どのファイルでも同じ値", () => {
  const files = ["index.html", "app.js", ...sh("ls js/*.js").split("\n")];
  const all = new Set(files.flatMap((f) => versions(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))));
  assert.equal(all.size, 1, `印がそろっていない：${[...all].join(", ")}`);
});
