// 食事記録ボットのリッチメニューの画像を描く（2500×1686）。line-meal-project の html/js/richmenu.js を写したもの（そのリポジトリは非公開）。
// ボタンの位置は、ボットの GAS（4_ui.richmenu.gs の RICH_MENU_LAYOUT）と同じ。描く字・色はボットの色（テラコッタ）のまま
//   しょくじが描くのは、その人の「⚡ よく記録」タブだけ（よく記録するもの 6 品／ほかを入力・並べかえ）。
//   全員共通の「📝 記録」の画像は、img/meal-richmenu-main.png（ボットの GAS が使う）
import { fmt } from "./stats.js?v=202610251100";

export const LAYOUT = { width: 2500, height: 1686, tabHeight: 250, quickRows: 2, quickCols: 3, quickFooterHeight: 236, quickCount: 6 };
const C = { bg: "#FBF3EE", card: "#FFFFFF", accent: "#C8553D", accentSoft: "#FDEEE8", ink: "#2D211C", sub: "#6B5E57", line: "#EFE1D9" };
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';

async function ready() {
  try {
    await Promise.all([document.fonts.load(`800 80px ${FONT}`), document.fonts.load(`700 60px ${FONT}`)]);
  } catch {
    // 字が読みこめなくても、ほかの字で描く
  }
}

function canvas() {
  const c = document.createElement("canvas");
  c.width = LAYOUT.width;
  c.height = LAYOUT.height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  return { c, ctx };
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// 枠に入るように字を小さくする（2行まで）
function fitText(ctx, text, maxWidth, size, weight = 800) {
  let s = size;
  const lines = (fs) => {
    ctx.font = `${weight} ${fs}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return [text];
    // 2行に分ける：空白で分けられて、どちらの行も入るなら空白で（「牛丼 吉野家｜並」より「牛丼｜吉野家 並」）
    const spaces = [...text.matchAll(/\s+/g)].map((m) => m.index);
    for (const at of spaces.sort((a, b) => Math.abs(a - text.length / 2) - Math.abs(b - text.length / 2))) {
      const a = text.slice(0, at).trim();
      const b = text.slice(at).trim();
      if (ctx.measureText(a).width <= maxWidth && ctx.measureText(b).width <= maxWidth) return [a, b];
    }
    const chars = [...text];
    let line = "";
    for (let i = 0; i < chars.length; i++) {
      if (ctx.measureText(line + chars[i]).width > maxWidth) {
        const rest = chars.slice(i).join("");
        return [line, rest];
      }
      line += chars[i];
    }
    return [line];
  };
  let out = lines(s);
  while (s > 40 && (out.length > 2 || out.some((l) => ctx.measureText(l).width > maxWidth))) {
    s -= 6;
    out = lines(s);
  }
  if (out.length > 2) out = [out[0], `${out[1].slice(0, -1)}…`];
  return { lines: out, size: s };
}

function drawTabs(ctx, active) {
  const half = LAYOUT.width / 2;
  const tabs = [
    { key: "main", label: "📝 記録" },
    { key: "quick", label: "⚡ よく記録" },
  ];
  tabs.forEach((t, i) => {
    const on = t.key === active;
    ctx.fillStyle = on ? C.accent : C.accentSoft;
    ctx.fillRect(i * half, 0, half, LAYOUT.tabHeight);
    ctx.fillStyle = on ? "#FFFFFF" : C.sub;
    ctx.font = `800 96px ${FONT}`;
    ctx.fillText(t.label, i * half + half / 2, LAYOUT.tabHeight / 2 + 4);
  });
  ctx.fillStyle = C.line;
  ctx.fillRect(half - 2, 30, 4, LAYOUT.tabHeight - 60);
}

function cell(ctx, x, y, w, h, { icon, label, sub, color, pad = 18 }) {
  roundRect(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, 48, C.card, C.line);
  if (color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + pad, y + pad, w - pad * 2, 26, [48, 48, 0, 0]);
    ctx.fill();
  }
  const cx = x + w / 2;
  if (icon) {
    ctx.font = `140px ${FONT}`;
    ctx.fillText(icon, cx, y + h * 0.36);
  }
  const fit = fitText(ctx, label, w - pad * 2 - 60, icon ? 92 : 104);
  ctx.fillStyle = C.ink;
  ctx.font = `800 ${fit.size}px ${FONT}`;
  const baseY = icon ? y + h * 0.66 : y + h * (sub ? 0.42 : 0.5);
  const lh = fit.size * 1.15;
  fit.lines.forEach((l, i) => ctx.fillText(l, cx, baseY + (i - (fit.lines.length - 1) / 2) * lh));
  if (sub) {
    ctx.fillStyle = C.sub;
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(sub, cx, y + h * (icon ? 0.84 : 0.76));
  }
}

function exportImage(c) {
  // LINE は 1MB まで。PNG が大きいときは JPEG に
  let url = c.toDataURL("image/png");
  if (url.length > 1300000) url = c.toDataURL("image/jpeg", 0.88);
  return url;
}

// その人の「⚡ よく記録」。items：[{ name, kcal, pinned }]（6品まで。足りないところは空き）
export async function drawQuickMenu(items) {
  await ready();
  const { c, ctx } = canvas();
  drawTabs(ctx, "quick");
  const top = LAYOUT.tabHeight;
  const gridH = LAYOUT.height - top - LAYOUT.quickFooterHeight;
  const cw = LAYOUT.width / LAYOUT.quickCols;
  const ch = gridH / LAYOUT.quickRows;
  for (let i = 0; i < LAYOUT.quickCount; i++) {
    const x = (i % LAYOUT.quickCols) * cw;
    const y = top + Math.floor(i / LAYOUT.quickCols) * ch;
    const it = items[i];
    if (it) {
      cell(ctx, x, y, cw, ch, { label: `${it.pinned ? "📌" : ""}${it.name}`, sub: it.kcal != null ? `${fmt(Math.round(it.kcal))} kcal` : "" });
    } else {
      roundRect(ctx, x + 18, y + 18, cw - 36, ch - 36, 48, null, C.line);
      ctx.fillStyle = C.line;
      ctx.font = `700 64px ${FONT}`;
      ctx.fillText("あき", x + cw / 2, y + ch / 2);
    }
  }
  const fy = LAYOUT.height - LAYOUT.quickFooterHeight;
  const half = LAYOUT.width / 2;
  ctx.fillStyle = C.accentSoft;
  ctx.fillRect(0, fy, LAYOUT.width, LAYOUT.quickFooterHeight);
  ctx.fillStyle = C.accent;
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText("📝 ほかを入力", half / 2, fy + LAYOUT.quickFooterHeight / 2 + 4);
  ctx.fillText("📌 並べかえ", half + half / 2, fy + LAYOUT.quickFooterHeight / 2 + 4);
  ctx.fillStyle = C.line;
  ctx.fillRect(half - 2, fy + 40, 4, LAYOUT.quickFooterHeight - 80);
  return exportImage(c);
}
