import { randomUUID } from "node:crypto";
import {
  parseCookieString,
  serializeCookies,
} from "./cookies.js";
import { loadSunoCookieHeader } from "./session-store.js";

const STUDIO_API = "https://studio-api.prod.suno.com";
const CLERK_BASE = "https://auth.suno.com";
const CLERK_VERSION = "5.117.0";
const DEFAULT_MODEL = "chirp-v3-5";

export interface SunoClip {
  id: string;
  title?: string;
  audio_url?: string;
  status?: string;
  duration?: number | string;
  metadata?: { duration?: number | string; error_message?: string };
  error_message?: string;
}

export interface SunoSessionOptions {
  cookie: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadSunoCookie(
  envCookie?: string,
  cookieFilePath?: string,
  storageStatePath?: string,
): string {
  return loadSunoCookieHeader(envCookie, {
    storageStatePath: storageStatePath ?? "",
    cookieFilePath: cookieFilePath ?? "",
  });
}

export class SunoSession {
  private readonly cookies: Record<string, string>;
  private readonly deviceId: string;
  private sid?: string;
  private currentToken?: string;

  private constructor(cookies: Record<string, string>, deviceId: string) {
    this.cookies = cookies;
    this.deviceId = deviceId;
  }

  static async open(options: SunoSessionOptions): Promise<SunoSession> {
    const parsed = parseCookieString(options.cookie);
    if (!parsed.__client) {
      throw new Error("Suno cookie is missing __client — log in again.");
    }

    const session = new SunoSession(
      parsed,
      parsed.ajs_anonymous_id || randomUUID(),
    );
    await session.init();
    return session;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Affiliate-Id": "undefined",
      "Device-Id": `"${this.deviceId}"`,
      "x-suno-client": "Android prerelease-4nt180t 1.0.42",
      "X-Requested-With": "com.suno.android",
      Cookie: serializeCookies(this.cookies),
      ...extra,
    };
    if (this.currentToken) {
      headers.Authorization = `Bearer ${this.currentToken}`;
    }
    return headers;
  }

  private async request<T>(
    url: string,
    init: RequestInit = {},
    attempt = 0,
  ): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookie) {
      const parsed = parseCookieString(header.split(";")[0] ?? "");
      Object.assign(this.cookies, parsed);
    }

    if (response.status === 429 && attempt < 6) {
      const waitMs = Math.min(5000 * 2 ** attempt, 60_000);
      console.log(`Suno rate limited — waiting ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
      return this.request(url, init, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Suno API ${response.status}: ${body.slice(0, 300)}`);
    }

    return (await response.json()) as T;
  }

  private async init(): Promise<void> {
    const url =
      `${CLERK_BASE}/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=${CLERK_VERSION}`;
    const data = await this.request<{
      response?: { last_active_session_id?: string };
    }>(url, {
      headers: { Authorization: this.cookies.__client },
    });

    const sid = data.response?.last_active_session_id;
    if (!sid) {
      throw new Error(
        "Failed to get Suno session — cookie may be expired. Run: npm run library:suno-login",
      );
    }
    this.sid = sid;
    await this.keepAlive();
  }

  async keepAlive(): Promise<void> {
    if (!this.sid) throw new Error("Suno session not initialized");

    const url =
      `${CLERK_BASE}/v1/client/sessions/${this.sid}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=${CLERK_VERSION}`;
    const data = await this.request<{ jwt?: string }>(url, {
      method: "POST",
      headers: { Authorization: this.cookies.__client },
    });

    if (!data.jwt) {
      throw new Error("Failed to refresh Suno auth token");
    }
    this.currentToken = data.jwt;
  }

  async getCredits(): Promise<{
    credits_left: number;
    period: string;
    monthly_limit: number;
    monthly_usage: number;
  }> {
    await this.keepAlive();
    const data = await this.request<{
      total_credits_left: number;
      period: string;
      monthly_limit: number;
      monthly_usage: number;
    }>(`${STUDIO_API}/api/billing/info/`);

    return {
      credits_left: data.total_credits_left,
      period: data.period,
      monthly_limit: data.monthly_limit,
      monthly_usage: data.monthly_usage,
    };
  }

  async captchaRequired(): Promise<boolean> {
    await this.keepAlive();
    const data = await this.request<{ required?: boolean }>(
      `${STUDIO_API}/api/c/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctype: "generation" }),
      },
    );
    return Boolean(data.required);
  }

  async generate(params: {
    prompt: string;
    instrumental: boolean;
    captchaToken: string | null;
  }): Promise<SunoClip[]> {
    await this.keepAlive();

    const payload = {
      make_instrumental: params.instrumental,
      mv: DEFAULT_MODEL,
      prompt: "",
      gpt_description_prompt: params.prompt,
      generation_type: "TEXT",
      token: params.captchaToken,
    };

    const data = await this.request<{ clips?: SunoClip[] }>(
      `${STUDIO_API}/api/generate/v2/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!data.clips?.length) {
      throw new Error("Suno generate returned no clips");
    }

    return data.clips;
  }

  async getClips(ids: string[]): Promise<SunoClip[]> {
    await this.keepAlive();
    const url = new URL(`${STUDIO_API}/api/feed/v2`);
    url.searchParams.set("ids", ids.join(","));

    const data = await this.request<{ clips?: SunoClip[] }>(url.href);
    return data.clips ?? [];
  }

  /** Wait until at least one clip has a downloadable audio URL. */
  async waitForClips(
    ids: string[],
    timeoutMs: number,
    pollMs: number,
    onProgress?: (clips: SunoClip[]) => void,
  ): Promise<SunoClip[]> {
    const deadline = Date.now() + timeoutMs;
    let last: SunoClip[] = [];

    while (Date.now() < deadline) {
      last = await this.getClips(ids);
      onProgress?.(last);

      const ready = last.filter((clip) => clip.audio_url);
      if (ready.length > 0) return ready;

      if (last.length > 0 && last.every((c) => c.status === "error")) {
        throw new Error(
          last[0]?.metadata?.error_message ??
            last[0]?.error_message ??
            "Suno generation failed",
        );
      }

      await sleep(pollMs);
      await this.keepAlive();
    }

    throw new Error(
      `Audio not ready after ${Math.round(timeoutMs / 1000)}s (last status: ${last.map((c) => c.status).join(", ") || "unknown"})`,
    );
  }
}
