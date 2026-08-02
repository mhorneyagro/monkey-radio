import { resolve } from "node:path";
import {
  closeBrowserSession,
  ensureLoggedIn,
  launchSunoBrowser,
} from "./browser-context.js";
import type { SessionPaths } from "./session-store.js";

export interface SunoLoginOptions extends SessionPaths {}

export async function runSunoLogin(options: SunoLoginOptions): Promise<void> {
  const session = await launchSunoBrowser({
    ...options,
    headless: false,
  });

  try {
    await ensureLoggedIn(session);
    console.log(`Saved browser session → ${options.storageStatePath}`);
    console.log(`Saved cookie file    → ${options.cookieFilePath}`);
  } finally {
    await closeBrowserSession(session);
  }
}

export function resolveSunoLoginPaths(
  repoRoot: string,
  config: {
    sunoBrowserStatePath?: string;
    sunoCookieFilePath?: string;
  },
): SunoLoginOptions {
  return {
    storageStatePath: resolve(
      repoRoot,
      config.sunoBrowserStatePath ?? "./data/suno-browser-state.json",
    ),
    cookieFilePath: resolve(
      repoRoot,
      config.sunoCookieFilePath ?? "./data/suno-cookie.txt",
    ),
  };
}
