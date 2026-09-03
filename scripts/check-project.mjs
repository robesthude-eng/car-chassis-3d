import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const indexPath = path.join(root, "index.html");
const srcDir = path.join(root, "src");
const html = fs.readFileSync(indexPath, "utf8");
const errors = [];

function collectJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJsFiles(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

const jsFiles = collectJsFiles(srcDir);
const app = jsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [
  ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
];
if (duplicateIds.length)
  errors.push(`Повторяющиеся id: ${duplicateIds.join(", ")}`);

const referencedIds = [
  ...app.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g),
].map((match) => match[1]);
const missingIds = [
  ...new Set(referencedIds.filter((id) => !ids.includes(id))),
];
if (missingIds.length)
  errors.push(`В коде запрошены отсутствующие id: ${missingIds.join(", ")}`);

for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
  const attributes = [
    ...tag.matchAll(/\s([:\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g),
  ].map((match) => match[1].toLowerCase());
  const duplicates = [
    ...new Set(
      attributes.filter((name, index) => attributes.indexOf(name) !== index),
    ),
  ];
  if (duplicates.length)
    errors.push(
      `Повтор атрибута ${duplicates.join(", ")} в ${tag.slice(0, 120)}`,
    );
}

for (const button of html.match(/<button\b[^>]*>/gi) ?? []) {
  if (!/\btype="button"/i.test(button))
    errors.push(`У кнопки не задан type="button": ${button.slice(0, 120)}`);
}

for (const tab of html.match(/<button\b[^>]*\brole="tab"[^>]*>/gi) ?? []) {
  const controls = tab.match(/\baria-controls="([^"]+)"/i)?.[1];
  if (!controls || !ids.includes(controls))
    errors.push(
      `Вкладка ссылается на отсутствующую панель: ${tab.slice(0, 120)}`,
    );
}

if (!/<script\s+type="module"\s+src="\/src\/app\.js"><\/script>/i.test(html)) {
  errors.push("Не найден модульный вход /src/app.js.");
}

if (/https?:\/\//i.test(html))
  errors.push("index.html содержит внешнюю сетевую зависимость.");
if (fs.statSync(path.join(root, "car_chassis_3d.html")).size > 4096) {
  errors.push(
    "Совместимый файл car_chassis_3d.html снова содержит копию приложения.",
  );
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `Проверено: ${ids.length} DOM id, ${referencedIds.length} связей интерфейса, ${jsFiles.length} JS-модулей, дубликатов нет.`,
);
