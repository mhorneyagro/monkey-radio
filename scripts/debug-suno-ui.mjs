#!/usr/bin/env node
import { chromium } from "playwright";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const storageState = resolve(repoRoot, "data/suno-browser-state.json");
const outDir = resolve(repoRoot, "data/temp/suno-debug");

if (!existsSync(storageState)) {
  console.error("No storage state — run library:suno-login first");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

await page.goto("https://suno.com/create", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(8000);

await page.screenshot({ path: resolve(outDir, "create-page.png"), fullPage: true });

const info = await page.evaluate(() => {
  const results = {
    url: location.href,
    title: document.title,
    textareas: [],
    contentEditables: [],
    textboxes: [],
    placeholders: [],
    buttons: [],
    inputs: [],
  };

  for (const el of document.querySelectorAll("textarea")) {
    const r = el.getBoundingClientRect();
    results.textareas.push({
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute("aria-label"),
      id: el.id,
      className: el.className?.slice?.(0, 120),
      visible: r.width > 0 && r.height > 0,
    });
  }

  for (const el of document.querySelectorAll('[contenteditable="true"]')) {
    const r = el.getBoundingClientRect();
    results.contentEditables.push({
      ariaLabel: el.getAttribute("aria-label"),
      role: el.getAttribute("role"),
      className: el.className?.slice?.(0, 120),
      visible: r.width > 0 && r.height > 0,
    });
  }

  for (const el of document.querySelectorAll('[role="textbox"]')) {
    const r = el.getBoundingClientRect();
    results.textboxes.push({
      ariaLabel: el.getAttribute("aria-label"),
      placeholder: el.getAttribute("placeholder"),
      className: el.className?.slice?.(0, 120),
      visible: r.width > 0 && r.height > 0,
    });
  }

  for (const el of document.querySelectorAll("input, textarea, [contenteditable]")) {
    const ph = el.getAttribute("placeholder") || el.getAttribute("aria-label");
    if (ph) results.placeholders.push(ph.slice(0, 100));
  }

  for (const el of document.querySelectorAll("button")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const label = el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 40);
    if (label) results.buttons.push(label);
  }

  return results;
});

writeFileSync(resolve(outDir, "dom-info.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
console.log("\nScreenshot:", resolve(outDir, "create-page.png"));

await browser.close();
