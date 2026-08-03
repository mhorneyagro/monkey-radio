#!/usr/bin/env node
/** Render assets/thumbnail/thumbnail.html → youtube-thumbnail.png (1280×720). */

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const htmlPath = path.join(repoRoot, "assets/thumbnail/thumbnail.html");
const outputPath = path.join(repoRoot, "assets/thumbnail/youtube-thumbnail.png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});

await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
await page.waitForSelector(".logo", { state: "visible" });
await page.waitForTimeout(300);

await page.screenshot({
  path: outputPath,
  type: "png",
  clip: { x: 0, y: 0, width: 1280, height: 720 },
});

await browser.close();
console.log(`Wrote ${outputPath}`);
