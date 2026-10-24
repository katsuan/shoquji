// 消すのは「元に戻す」を押せるあいだ待ってから、ボットにも送る（閉じる・ほかのアプリに切りかえるときは、すぐ送る）
//   key：「own:<しょくじの記録の id>」か「bot:<ボットの記録の logId>」。run(keepalive) が実際に消す
const UNDO_MS = 6500;
const pending = new Map(); // key → { run, timer }

export function queueRemoval(key, run) {
  cancelRemoval(key);
  pending.set(key, { run, timer: setTimeout(() => flushRemoval(key), UNDO_MS) });
}

export function cancelRemoval(key) {
  const p = pending.get(key);
  if (p) clearTimeout(p.timer);
  pending.delete(key);
}

// まだ待っているか（「元に戻す」で取りやめられるか）
export const isWaiting = (key) => pending.has(key);

// 待っている「しょくじの記録」の id
export const waitingOwnIds = () => new Set([...pending.keys()].filter((k) => k.startsWith("own:")).map((k) => k.slice(4)));

async function flushRemoval(key, keepalive = false) {
  const p = pending.get(key);
  if (!p) return;
  cancelRemoval(key);
  await p.run(keepalive);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") [...pending.keys()].forEach((key) => flushRemoval(key, true));
});
