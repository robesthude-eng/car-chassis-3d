import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { build } from "vite";

const root = process.cwd();
const temporaryOutput = path.join(root, ".standalone-build");
const standaloneDir = path.join(root, "standalone");

await build({
  root,
  configFile: false,
  base: "./",
  build: {
    outDir: temporaryOutput,
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

const assetsDir = path.join(temporaryOutput, "assets");
const assets = fs.readdirSync(assetsDir);
const scriptName = assets.find((name) => name.endsWith(".js"));
const styleName = assets.find((name) => name.endsWith(".css"));
if (!scriptName || !styleName) {
  throw new Error(
    "Standalone build requires exactly one JavaScript and one CSS asset.",
  );
}

const script = fs
  .readFileSync(path.join(assetsDir, scriptName), "utf8")
  .replaceAll("</script", "<\\/script");
const style = fs
  .readFileSync(path.join(assetsDir, styleName), "utf8")
  .replaceAll("</style", "<\\/style");
let html = fs.readFileSync(path.join(temporaryOutput, "index.html"), "utf8");
html = html
  .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${style}</style>`)
  .replace(
    /<script type="module"[^>]*><\/script>/,
    () => `<script type="module">${script}</script>`,
  );

if (
  html.includes(`src="./assets/${scriptName}"`) ||
  html.includes(`href="./assets/${styleName}"`)
) {
  throw new Error(
    "Standalone HTML still references an external JavaScript or CSS asset.",
  );
}

fs.mkdirSync(standaloneDir, { recursive: true });
fs.writeFileSync(path.join(standaloneDir, "index.html"), html);
fs.writeFileSync(path.join(standaloneDir, "car_chassis_3d.html"), html);
fs.rmSync(temporaryOutput, { recursive: true, force: true });

console.log(
  `Автономная сборка: ${(Buffer.byteLength(html) / 1024).toFixed(1)} КБ.`,
);
