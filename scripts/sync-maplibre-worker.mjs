/**
 * Copy MapLibre's ESM worker + shared sibling into public/ so Next can
 * serve them same-origin. The worker imports ./maplibre-gl-shared.mjs, so
 * both files must sit next to each other (see MapLibre v6 webpack bundler test).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "public", "maplibre");

mkdirSync(destDir, { recursive: true });

for (const file of [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
]) {
  const from = require.resolve(`maplibre-gl/dist/${file}`);
  const to = join(destDir, file);
  copyFileSync(from, to);
  console.log(`synced ${file} -> public/maplibre/${file}`);
}
