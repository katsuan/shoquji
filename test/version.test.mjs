// 読みこみの印（?v=…）を変え忘れていないか
//   app.js・style.css・js/*.js を変えたのに印が前のコミットと同じだと、ブラウザが古い部品と新しい部品をまぜて読み、
//   「〇〇という名前はない」で止まって、画面がまるごと出なくなる（2026-10-24 に起きた）
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

test("部品を変えたら、読みこみの印も変える", () => {
  let changed = "";
  try {
    changed = sh("git diff --name-only HEAD -- app.js style.css js");
  } catch {
    return; // git がないところでは見ない
  }
  if (!changed) return;
  const now = versions(readFileSync(new URL("../index.html", import.meta.url), "utf8"))[0];
  const before = versions(sh("git show HEAD:index.html"))[0];
  assert.notEqual(now, before, `変えたファイル（${changed.replace(/\n/g, "・")}）があるのに、印が前と同じ（?v=${now}）。index.html・app.js・js/*.js の ?v= をそろえて新しくする`);
});
