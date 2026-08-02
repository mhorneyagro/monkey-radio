import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { SessionPaths } from "./session-store.js";
import {
  contextHasAuthCookie,
  saveBrowserSession,
} from "./session-store.js";

export interface BrowserLaunchOptions {
  storageStatePath: string;
  headless?: boolean;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  paths: SessionPaths;
}

export async function launchSunoBrowser(
  options: BrowserLaunchOptions & SessionPaths,
): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: options.headless ?? false,
  });

  const context = await browser.newContext({
    ...(existsSync(options.storageStatePath)
      ? { storageState: options.storageStatePath }
      : {}),
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    paths: {
      storageStatePath: options.storageStatePath,
      cookieFilePath: options.cookieFilePath,
    },
  };
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await session.browser.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Quick auth check — does not navigate (create page load happens next).
 */
export async function ensureLoggedIn(session: BrowserSession): Promise<void> {
  const { page, context } = session;

  console.log("Checking Suno session...");
  await page.goto("https://suno.com/create", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await sleep(2000);

  if (await contextHasAuthCookie(context)) {
    console.log("Suno session active");
    await saveBrowserSession(context, session.paths);
    return;
  }

  console.log("\n>>> Log in to Suno in the browser window.");
  console.log(">>> Waiting for login to complete...\n");

  if (!page.url().includes("login") && !page.url().includes("sign")) {
    await page.goto("https://suno.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await contextHasAuthCookie(context)) {
      await sleep(1500);
      await saveBrowserSession(context, session.paths);
      console.log("Login detected — session saved");
      return;
    }
    await sleep(1000);
  }

  throw new Error("Login timed out after 5 minutes");
}
