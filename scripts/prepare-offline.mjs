import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = readdirSync(resolve(root, "dist/assets"))
  .filter((name) => /\.(js|mjs|css|woff2)$/.test(name))
  .sort()
  .map((name) => `/assets/${name}`);
const worker = readFileSync(resolve(root, "public/sw.js"), "utf8");
const hash = createHash("sha256").update(worker);
for (const file of [
  ...assets,
  "/index.html",
  "/manifest.webmanifest",
  "/samples/derivatives.png",
  "/icon-192.png",
  "/icon-512.png",
])
  hash.update(readFileSync(resolve(root, `dist${file}`)));
writeFileSync(
  resolve(root, "dist/sw.js"),
  worker
    .replace("__NOTEPILOT_BUILD__", hash.digest("hex").slice(0, 12))
    .replace(
      "const BUILD_ASSETS = [];",
      `const BUILD_ASSETS = ${JSON.stringify(assets)};`,
    ),
);
