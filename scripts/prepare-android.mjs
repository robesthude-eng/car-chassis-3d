/** Готовит dist для Android: игра становится стартовым экраном, стенд остаётся доступен. */
import { copyFileSync, renameSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");
const idx = resolve(dist, "index.html");
const game = resolve(dist, "game.html");
if (!existsSync(game)) throw new Error("dist/game.html не найден — сначала vite build");

renameSync(idx, resolve(dist, "bench.html"));
copyFileSync(game, idx);
console.log("Android: index.html = игра, стенд перенесён в bench.html");
