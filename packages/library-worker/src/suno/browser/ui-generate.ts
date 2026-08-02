import type { Page } from "playwright";
import type { SessionPaths } from "./session-store.js";
import {
  closeBrowserSession,
  ensureLoggedIn,
  launchSunoBrowser,
  type BrowserSession,
} from "./browser-context.js";
import { saveBrowserSession } from "./session-store.js";
import { SunoSession, type SunoClip } from "./session.js";
import { toSunoTrack } from "./clips.js";
import type { SunoTrack } from "../client.js";

export interface UiGenerateOptions {
  prompt: string;
  instrumental: boolean;
  submitTimeoutMs: number;
  renderTimeoutMs: number;
  paths: SessionPaths;
}

export interface UiGenerateResult {
  clipIds: string[];
  title?: string;
  cookieHeader: string;
  readyTrack: SunoTrack;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dismissPopups(page: Page): Promise<void> {
  for (const label of [
    "Accept All Cookies",
    "Reject All",
    "Close",
    "Dismiss",
    "Got it",
    "Accept",
    "Not now",
  ]) {
    try {
      await page.getByRole("button", { name: label }).click({ timeout: 1500 });
      await sleep(400);
    } catch {
      // ignore
    }
  }
}

async function ensureSimpleMode(page: Page): Promise<void> {
  try {
    const simple = page.getByRole("button", { name: "Simple", exact: true });
    await simple.click({ timeout: 3000 });
    await sleep(500);
    console.log("Simple mode selected");
  } catch {
    console.log("Simple mode button not found — continuing");
  }
}

async function prepareCreatePage(page: Page): Promise<void> {
  console.log("Loading create page...");

  const projectPromise = page
    .waitForResponse(
      (resp) =>
        resp.url().includes("/api/project/") && resp.status() === 200,
      { timeout: 30_000 },
    )
    .catch(() => undefined);

  await page.goto("https://suno.com/create", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await projectPromise;
  await sleep(2000);
  await dismissPopups(page);
  await ensureSimpleMode(page);

  console.log("Waiting for song prompt field...");
  await waitForPromptField(page);
  console.log("Create page ready");
}

async function waitForPromptField(page: Page): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const input = await findPromptInput(page, 2000);
    if (input) return;
    await dismissPopups(page);
    await sleep(1000);
  }
  throw new Error(
    "Could not find the Suno prompt field.\n" +
      "Make sure Simple mode is visible with the Song Description box.",
  );
}

async function findPromptInput(page: Page, timeoutMs = 4000) {
  const candidates = [
    page.locator('textarea[placeholder*="song about"]').first(),
    page.getByPlaceholder(/song about/i),
    page.locator('textarea[placeholder*="Describe the sound"]').first(),
    page.getByPlaceholder(/describe the sound/i),
    page.getByPlaceholder(/describe|prompt|song idea|what do you want/i),
    page.getByLabel("Cowriter prompt"),
    page.locator("textarea:visible").first(),
  ];

  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch {
      // try next
    }
  }

  return null;
}

async function setInstrumental(page: Page, enabled: boolean): Promise<void> {
  if (!enabled) return;

  console.log("Enabling instrumental mode...");
  const strategies: Array<() => Promise<boolean>> = [
    async () => {
      const toggle = page.getByRole("button", {
        name: /instrumental only/i,
      });
      await toggle.waitFor({ state: "visible", timeout: 3000 });
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      return true;
    },
    async () => {
      const radio = page.getByRole("radio", { name: "Instrumental", exact: true });
      await radio.waitFor({ state: "visible", timeout: 3000 });
      await radio.scrollIntoViewIfNeeded();
      await radio.click();
      return true;
    },
    async () => {
      const toggle = page.locator(
        '[aria-label*="instrumental only" i]',
      ).first();
      await toggle.waitFor({ state: "visible", timeout: 3000 });
      await toggle.click();
      return true;
    },
  ];

  for (const strategy of strategies) {
    try {
      if (await strategy()) {
        console.log("Instrumental mode enabled");
        return;
      }
    } catch {
      // try next
    }
  }

  console.warn(
    "Could not find Instrumental toggle — enable it manually if needed",
  );
}

async function clickCreate(page: Page): Promise<void> {
  await dismissPopups(page);

  const candidates = [
    page.getByRole("button", { name: /create song/i }),
    page.getByRole("button", { name: /^create$/i }).last(),
    page.getByRole("button", { name: /generate/i }),
    page.locator('button[aria-label="Create"]').first(),
    page.locator('button:has-text("Create")').last(),
  ];

  for (const locator of candidates) {
    try {
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: 5000 });
      return;
    } catch {
      // try next
    }
  }

  throw new Error("Could not find the Create button");
}

async function fillPrompt(page: Page, prompt: string): Promise<void> {
  const input = await findPromptInput(page);
  if (!input) {
    throw new Error("Prompt field disappeared before fill");
  }
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill("");
  await input.fill(prompt);
  console.log(`Prompt filled (${prompt.length} chars)`);
}

function watchGenerationResponses(
  page: Page,
  submitTimeoutMs: number,
): {
  promise: Promise<{ clipIds: string[]; title?: string }>;
  getSeenClipIds: () => string[];
} {
  const seenClipIds = new Set<string>();

  const promise = new Promise<{ clipIds: string[]; title?: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        const fallback = [...seenClipIds];
        if (fallback.length > 0) {
          resolve({ clipIds: fallback });
          return;
        }
        reject(
          new Error(
            `Generation timed out after ${Math.round(submitTimeoutMs / 1000)}s.\n` +
              "If a CAPTCHA appeared, solve it in the browser and click Create again.",
          ),
        );
      }, submitTimeoutMs);

      const handler = async (response: {
        url: () => string;
        status: () => number;
        json: () => Promise<unknown>;
      }) => {
        const url = response.url();
        const isGenerate = url.includes("/api/generate/");
        const isFeed = url.includes("/api/feed/v2");
        if (!isGenerate && !isFeed) return;
        if (response.status() !== 200) return;

        try {
          const data = (await response.json()) as {
            clips?: Array<{ id?: string; title?: string; audio_url?: string }>;
          };
          const clips = data.clips ?? [];
          for (const clip of clips) {
            if (clip.id) seenClipIds.add(clip.id);
          }

          if (isGenerate && clips.length > 0) {
            const clipIds = clips
              .map((clip) => clip.id)
              .filter((id): id is string => Boolean(id));
            if (clipIds.length > 0) {
              clearTimeout(timer);
              page.off("response", handler);
              resolve({ clipIds, title: clips[0]?.title });
            }
          }
        } catch {
          // ignore malformed responses
        }
      };

      page.on("response", handler);
    },
  );

  return {
    promise,
    getSeenClipIds: () => [...seenClipIds],
  };
}

/** Wait for audio by listening to feed API responses in the open browser (no extra API calls). */
async function waitForAudioInBrowser(
  page: Page,
  clipIds: string[],
  renderTimeoutMs: number,
): Promise<SunoClip> {
  let lastLog = 0;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off("response", handler);
      reject(
        new Error(
          `Audio not ready after ${Math.round(renderTimeoutMs / 1000)}s.\n` +
            "The tracks may still be rendering in your Suno library.",
        ),
      );
    }, renderTimeoutMs);

    const handler = async (response: {
      url: () => string;
      status: () => number;
      json: () => Promise<unknown>;
    }) => {
      if (
        !response.url().includes("/api/feed/v2") ||
        response.status() !== 200
      ) {
        return;
      }

      try {
        const data = (await response.json()) as { clips?: SunoClip[] };
        const matching = (data.clips ?? []).filter((clip) =>
          clipIds.includes(clip.id),
        );

        for (const clip of matching) {
          if (clip.audio_url) {
            clearTimeout(timer);
            page.off("response", handler);
            resolve(clip);
            return;
          }
        }

        const now = Date.now();
        if (now - lastLog > 8000 && matching.length > 0) {
          lastLog = now;
          console.log(
            `Rendering... ${matching
              .map((clip) => `${clip.id.slice(0, 8)}:${clip.status ?? "?"}`)
              .join(", ")}`,
          );
        }
      } catch {
        // ignore malformed responses
      }
    };

    page.on("response", handler);
  });
}

async function waitForAudio(
  page: Page,
  clipIds: string[],
  cookieHeader: string,
  renderTimeoutMs: number,
): Promise<SunoClip> {
  try {
    return await waitForAudioInBrowser(page, clipIds, renderTimeoutMs);
  } catch (browserError) {
    console.warn(
      `Browser render wait failed: ${browserError instanceof Error ? browserError.message : browserError}`,
    );
    console.log("Falling back to slow API poll (15s interval)...");
    const session = await SunoSession.open({ cookie: cookieHeader });
    const ready = await session.waitForClips(
      clipIds,
      Math.min(renderTimeoutMs, 120_000),
      15_000,
      (clips) => {
        console.log(
          `Rendering... ${clips
            .map((clip) => `${clip.id.slice(0, 8)}:${clip.status ?? "?"}`)
            .join(", ")}`,
        );
      },
    );
    return ready[0];
  }
}

/**
 * One browser session: log in if needed, generate a track, save session for next run.
 */
export async function generateViaBrowserUI(
  options: UiGenerateOptions,
): Promise<UiGenerateResult> {
  let session: BrowserSession | undefined;

  try {
    session = await launchSunoBrowser({
      storageStatePath: options.paths.storageStatePath,
      cookieFilePath: options.paths.cookieFilePath,
      headless: false,
    });

    await ensureLoggedIn(session);
    await prepareCreatePage(session.page);

    console.log("Starting generation...");
    const generationWatch = watchGenerationResponses(
      session.page,
      options.submitTimeoutMs,
    );

    await setInstrumental(session.page, options.instrumental);
    await fillPrompt(session.page, options.prompt);

    console.log("Clicking Create...");
    await clickCreate(session.page);

    console.log(
      "\n>>> If a CAPTCHA appears, solve it in the browser window.",
      "\n>>> Waiting for Suno to accept the generation...\n",
    );

    const submitted = await generationWatch.promise;
    const clipIds =
      submitted.clipIds.length > 0
        ? submitted.clipIds
        : generationWatch.getSeenClipIds();

    if (clipIds.length === 0) {
      throw new Error("Suno did not return any clip IDs");
    }

    const cookieHeader = await saveBrowserSession(
      session.context,
      options.paths,
    );

    console.log(`Generation submitted — clip IDs: ${clipIds.join(", ")}`);
    console.log(
      "Waiting for audio to finish rendering (listening via browser)...",
    );

    const readyClip = await waitForAudio(
      session.page,
      clipIds,
      cookieHeader,
      options.renderTimeoutMs,
    );
    const readyTrack = toSunoTrack(readyClip);

    console.log(`Audio ready — ${readyTrack.title} (${readyTrack.duration}s)`);

    return {
      clipIds,
      title: submitted.title ?? readyTrack.title,
      cookieHeader,
      readyTrack,
    };
  } finally {
    if (session) await closeBrowserSession(session);
  }
}
