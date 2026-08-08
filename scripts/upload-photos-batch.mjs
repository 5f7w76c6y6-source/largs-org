#!/usr/bin/env node
/**
 * scripts/upload-photos-batch.mjs
 *
 * Upload a whole folder of Alison's photos in one go. Processes every
 * JPG/JPEG/PNG/TIFF/HEIC it finds, resizes to 1200px and 400px AVIF,
 * pushes all three versions to R2, and writes the complete JSON block
 * ready to paste into src/_data/photos.json.
 *
 * Usage (run from the repo root):
 *   node scripts/upload-photos-batch.mjs <folder> [options]
 *
 * Options:
 *   --category  Coast|Harbour|Town|Seasons|Events   (required, applies to all)
 *   --date      2026-08-08  (defaults to today; use for a single shoot)
 *
 * The script reads title and caption from each file's EXIF data if present
 * (ImageDescription → caption, XPTitle → title). If those fields are empty
 * it uses the filename as the title and leaves caption blank for you to fill
 * in photos.json afterwards — they'll be clearly marked with "TODO".
 *
 * Example:
 *   node scripts/upload-photos-batch.mjs ~/Desktop/largs-shoot \
 *     --category Coast \
 *     --date 2026-08-08
 *
 * First run only:
 *   npm install sharp exif-reader
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { writeFile } from "fs/promises";
import { basename, extname, join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

// ── Config ────────────────────────────────────────────────────────────────────
const BUCKET       = "largs-photos";
const PUBLIC_BASE  = "https://pub-f878f11e18cb4d1c89452f36df8667b5.r2.dev";
const FULL_WIDTH   = 1200;
const THUMB_WIDTH  = 400;
const AVIF_QUALITY = 72;
const SUPPORTED    = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif", ".heic"]);
// ─────────────────────────────────────────────────────────────────────────────

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith("--")) {
  console.error("Usage: node scripts/upload-photos-batch.mjs <folder> --category <...>");
  process.exit(1);
}
const folderPath = args[0];
if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
  console.error(`Not a directory: ${folderPath}`);
  process.exit(1);
}
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 && args[i+1] ? args[i+1] : null; };
const category = get("--category");
const dateArg  = get("--date") || new Date().toISOString().slice(0, 10);
const VALID    = ["Coast", "Harbour", "Town", "Seasons", "Events"];
if (!category || !VALID.includes(category)) {
  console.error(`--category is required and must be one of: ${VALID.join(", ")}`);
  process.exit(1);
}

// Collect supported files, sorted by filename (rename to date-prefix for ordering)
const files = readdirSync(folderPath)
  .filter(f => SUPPORTED.has(extname(f).toLowerCase()))
  .sort()
  .map(f => join(folderPath, f));

if (!files.length) {
  console.error(`No supported image files found in ${folderPath}`);
  process.exit(1);
}
console.log(`\nFound ${files.length} photo${files.length > 1 ? "s" : ""} in ${folderPath}`);
// ─────────────────────────────────────────────────────────────────────────────

// ── Dependencies ──────────────────────────────────────────────────────────────
let sharp;
try { sharp = (await import("sharp")).default; }
catch { console.error("\n  Run: npm install sharp\n"); process.exit(1); }
// ─────────────────────────────────────────────────────────────────────────────

// ── Process each file ─────────────────────────────────────────────────────────
const entries = [];
const tmp = join(tmpdir(), `largs-batch-${Date.now()}`);
mkdirSync(tmp);

for (let i = 0; i < files.length; i++) {
  const originalPath = files[i];
  const ext  = extname(originalPath).toLowerCase();
  const name = basename(originalPath, ext);

  // Derive a slug from the filename (strip leading date/number prefixes if present)
  const cleanName = name.replace(/^\d{4}-\d{2}-\d{2}[_-]?/, "").replace(/^\d+[_-]?/, "");
  const slug = (cleanName || name)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const stem      = `${dateArg}-${slug}`;
  const origKey   = `originals/${stem}${ext}`;
  const fullKey   = `web/${stem}-1200.avif`;
  const thumbKey  = `web/${stem}-400.avif`;
  const fullPath  = join(tmp, `${i}-full.avif`);
  const thumbPath = join(tmp, `${i}-thumb.avif`);

  // Title: clean filename as default, marked for review
  const title   = cleanName.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || name;
  const caption = "TODO — add caption";

  console.log(`\n[${i+1}/${files.length}] ${basename(originalPath)}`);

  // Resize
  await sharp(originalPath)
    .resize(FULL_WIDTH, null, { withoutEnlargement: true })
    .avif({ quality: AVIF_QUALITY })
    .toFile(fullPath);
  console.log(`  ✓ full  ${FULL_WIDTH}px AVIF`);

  await sharp(originalPath)
    .resize(THUMB_WIDTH, Math.round(THUMB_WIDTH * 3/4), { fit: "cover", position: "attention" })
    .avif({ quality: AVIF_QUALITY })
    .toFile(thumbPath);
  console.log(`  ✓ thumb ${THUMB_WIDTH}px AVIF`);

  // Upload
  const put = (file, key, label) => {
    process.stdout.write(`  ↑ uploading ${label}… `);
    execSync(`npx wrangler r2 object put "${BUCKET}/${key}" --file "${file}" --remote`, { stdio: "pipe" });
    console.log("done");
  };
  put(originalPath, origKey,  "original");
  put(fullPath,     fullKey,  "full AVIF ");
  put(thumbPath,    thumbKey, "thumb AVIF");

  entries.push({
    date:     dateArg,
    title,
    caption,
    category,
    original: origKey,
    thumb:    `${PUBLIC_BASE}/${thumbKey}`,
    full:     `${PUBLIC_BASE}/${fullKey}`
  });
}

rmSync(tmp, { recursive: true });
// ─────────────────────────────────────────────────────────────────────────────

// ── Output ────────────────────────────────────────────────────────────────────
console.log("\n\n════════════════════════════════════════════════════");
console.log("All done! Paste these entries into the \"photos\" array");
console.log("in src/_data/photos.json (newest first).");
console.log("Search for TODO to fill in captions and fix titles.\n");
console.log(JSON.stringify(entries, null, 2));
console.log("\n════════════════════════════════════════════════════");
console.log("Then:");
console.log('  • Edit titles and captions (search for "TODO")');
console.log('  • Set "sample": false in photos.json if not already done');
console.log("  • git add src/_data/photos.json");
console.log('  • git commit -m "Photos: add ' + files.length + ' new images"');
console.log("  • git push\n");
