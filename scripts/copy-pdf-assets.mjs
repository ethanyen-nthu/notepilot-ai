import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  const destination = resolve(root, "public/pdfjs", directory);
  mkdirSync(destination, { recursive: true });
  cpSync(resolve(root, "node_modules/pdfjs-dist", directory), destination, {
    recursive: true,
  });
}
