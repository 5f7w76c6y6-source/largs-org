#!/usr/bin/env node
/**
 * scripts/upload-photo.mjs
 *
 * Takes one of Alison's originals off your desktop, makes a 1200px
 * full-size AVIF and a 400px thumbnail AVIF, pushes all three to the
 * largs-photos R2 bucket, and prints the JSON entry ready to paste
 * into src/_data/photos.json.
 *
 * Usage (run from the repo root):
 *   node scripts/upload-photo.mjs <path-to-original> [options]
 *
 * Options:
 *   --title    "The Pencil at dusk"          (required)
 *   --caption  "Light fading over Cumbrae."  (required)
 *   --category Coast|Harbour|Town|Seasons|Events  (required)
 *   --date     2026-08-08  (defaults to today)
 *
 * Example:
 *   node scripts/upload-photo.mjs ~/Desktop/pencil.jpg \
 *     --title "The Pencil at dusk" \
 *     --caption "The Pencil monument on the Largs foreshore, light fading over Cumbrae." \
 *     --category Coast
 *
 * First run only — install the image library:
 *   npm install sharp
 *
 * Requires wrangler to be logged in (npx wrangler whoami should print
 * your account). The bucket name and public URL are baked in below.
 */

import { createReadStream, existsSync, mkdirSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { basename, extname, join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

// ── Config ────────────────────────────────────────────────────────────────────
const BUCKET      = "largs-photos";
const PUBLIC_BASE = "https://pub-f878f11e18cb4d1c89452f36df8667b5.r2.dev";
const FULL_WIDTH  = 1200;
const THUMB_WIDTH = 400;
const AVIF_QUALITY = 72;   // 0–100; 72 is excellent quality at a fraction of JPEG size
// ─────────────────────────────────────────────────────────────────────────────

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith("--")) {
  console.error("Usage: node scripts/upload-photo.mjs <path> --title \"...\" --caption \"...\" --category ...");
  process.exit(1);
}
const originalPath = args[0];
if (!existsSync(originalPath)) {
  console.error(`File not found: ${originalPath}`);
  process.exit(1);
}
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const title    = get("--title");
const caption  = get("--caption");
const category = get("--category");
const date     = get("--date") || new Date().toISOString().slice(0, 10);
const VALID_CATEGORIES = ["Coast", "Harbour", "Town", "Seasons", "Events"];
if (!title || !caption || !category) {
  console.error("--title, --caption and --category are all required.");
  process.exit(1);
}
if (!VALID_CATEGORIES.includes(category)) {
  console.error(`--category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Derive file keys from the title and date ──────────────────────────────────
const slug = title.toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 40);
const stem       = `${date}-${slug}`;
const origKey    = `originals/${stem}${extname(originalPath).toLowerCase()}`;
const fullKey    = `web/${stem}-1200.avif`;
const thumbKey   = `web/${stem}-400.avif`;
// ─────────────────────────────────────────────────────────────────────────────

// ── Check sharp is installed ──────────────────────────────────────────────────
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "\n  sharp is not installed. Run this once from the repo root:\n\n" +
    "    npm install sharp\n\n  Then re-run the upload.\n"
  );
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Resize ────────────────────────────────────────────────────────────────────
const tmp = join(tmpdir(), `largs-upload-${Date.now()}`);
mkdirSync(tmp);
const fullPath  = join(tmp, "full.avif");
const thumbPath = join(tmp, "thumb.avif");

console.log(`\nResizing ${basename(originalPath)}…`);
await sharp(originalPath)
  .resize(FULL_WIDTH, null, { withoutEnlargement: true })
  .avif({ quality: AVIF_QUALITY })
  .toFile(fullPath);
console.log(`  ✓  full  — ${FULL_WIDTH}px AVIF`);

await sharp(originalPath)
  .resize(THUMB_WIDTH, Math.round(THUMB_WIDTH * 3 / 4), {
    fit: "cover",
    position: "attention"   // smart crop: keeps faces and salient features
  })
  .avif({ quality: AVIF_QUALITY })
  .toFile(thumbPath);
console.log(`  ✓  thumb — ${THUMB_WIDTH}×${Math.round(THUMB_WIDTH * 3 / 4)}px AVIF`);
// ─────────────────────────────────────────────────────────────────────────────

// ── Upload via wrangler ───────────────────────────────────────────────────────
const put = (localFile, key, label) => {
  console.log(`\nUploading ${label}…`);
  execSync(
    `npx wrangler r2 object put "${BUCKET}/${key}" --file "${localFile}" --remote`,
    { stdio: "inherit" }
  );
};
put(originalPath, origKey,  "original (private)");
put(fullPath,     fullKey,  "full 1200px AVIF   (public)");
put(thumbPath,    thumbKey, "thumb 400px AVIF   (public)");
// ─────────────────────────────────────────────────────────────────────────────

// ── Clean up temp files ───────────────────────────────────────────────────────
rmSync(tmp, { recursive: true });
// ─────────────────────────────────────────────────────────────────────────────

// ── Print the JSON entry ──────────────────────────────────────────────────────
const entry = {
  date,
  title,
  caption,
  category,
  original: origKey,
  thumb: `${PUBLIC_BASE}/${thumbKey}`,
  full:  `${PUBLIC_BASE}/${fullKey}`
};

console.log("\n─────────────────────────────────────────────────");
console.log("Add this entry to src/_data/photos.json (newest first):\n");
console.log(JSON.stringify(entry, null, 2));
console.log("\n─────────────────────────────────────────────────");
console.log("Then: git add src/_data/photos.json && git commit -m \"Photos: add " + title + "\" && git push");
console.log("      (and set sample:false in photos.json if this is the first real photo)\n");
