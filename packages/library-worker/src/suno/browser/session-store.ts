import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext } from "playwright";
import { parseCookieString, serializeCookies } from "./cookies.js";

export interface SessionPaths {
  storageStatePath: string;
  cookieFilePath: string;
}

const SUNO_ORIGINS = [
  "https://suno.com",
  "https://www.suno.com",
  "https://auth.suno.com",
  "https://clerk.suno.com",
];

export function loadCookiesFromStorageState(
  storageStatePath: string,
): Record<string, string> {
  const data = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
    cookies?: Array<{ name: string; value: string; domain?: string }>;
  };

  const cookies: Record<string, string> = {};
  for (const cookie of data.cookies ?? []) {
    if (cookie.domain?.includes("suno.com")) {
      cookies[cookie.name] = cookie.value;
    }
  }
  return cookies;
}

export function hasAuthCookie(cookies: Record<string, string>): boolean {
  return Boolean(cookies.__client);
}

export function loadSunoCookieHeader(
  envCookie: string | undefined,
  paths: SessionPaths,
): string {
  if (envCookie?.includes("__client=")) return envCookie;

  if (existsSync(paths.storageStatePath)) {
    const fromState = loadCookiesFromStorageState(paths.storageStatePath);
    if (hasAuthCookie(fromState)) {
      return serializeCookies(fromState);
    }
  }

  if (existsSync(paths.cookieFilePath)) {
    const fromFile = readFileSync(paths.cookieFilePath, "utf8").trim();
    const parsed = parseCookieString(fromFile);
    if (hasAuthCookie(parsed)) return fromFile;
  }

  throw new Error(
    "No Suno session found — a browser window will open for you to log in.",
  );
}

export async function saveBrowserSession(
  context: BrowserContext,
  paths: SessionPaths,
): Promise<string> {
  mkdirSync(dirname(paths.storageStatePath), { recursive: true });
  mkdirSync(dirname(paths.cookieFilePath), { recursive: true });

  await context.storageState({ path: paths.storageStatePath });

  const cookies = await context.cookies(SUNO_ORIGINS);
  const cookieMap: Record<string, string> = {};
  for (const cookie of cookies) {
    cookieMap[cookie.name] = cookie.value;
  }

  const header = serializeCookies(cookieMap);
  writeFileSync(paths.cookieFilePath, header, "utf8");
  return header;
}

export async function contextHasAuthCookie(
  context: BrowserContext,
): Promise<boolean> {
  const cookies = await context.cookies(SUNO_ORIGINS);
  return cookies.some((cookie) => cookie.name === "__client");
}
