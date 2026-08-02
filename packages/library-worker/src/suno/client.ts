import type { LibraryWorkerConfig } from "@monkey-radio/shared";
import { BrowserSunoProvider } from "./browser/browser-provider.js";
import { GcuiSunoProvider } from "./gcui-provider.js";
import { HttpSunoProvider } from "./http-provider.js";
import { MockSunoProvider } from "./mock-provider.js";

export type SunoJobStatus = "pending" | "processing" | "complete" | "failed";

export interface SunoTrack {
  id: string;
  audioUrl: string;
  title: string;
  duration: number;
}

export interface SunoJobResult {
  status: SunoJobStatus;
  tracks?: SunoTrack[];
  error?: string;
}

export interface SunoProvider {
  submitGeneration(params: {
    prompt: string;
    genre: string;
    instrumental?: boolean;
  }): Promise<{ jobId: string }>;

  getJobStatus(jobId: string): Promise<SunoJobResult>;
}

export async function createSunoProvider(
  config: LibraryWorkerConfig,
): Promise<SunoProvider> {
  if (config.sunoProvider === "mock") {
    return new MockSunoProvider();
  }

  if (config.sunoProvider === "browser") {
    console.log("Using Suno browser provider (headed Playwright)");
    const provider = new BrowserSunoProvider(config);
    await provider.verifyConnection();
    return provider;
  }

  if (config.sunoProvider === "gcui") {
    const baseUrl = config.sunoApiBaseUrl ?? "http://localhost:3001";
    const provider = new GcuiSunoProvider({ baseUrl });
    await provider.verifyConnection();
    return provider;
  }

  if (!config.sunoApiBaseUrl || !config.sunoApiKey) {
    throw new Error(
      "SUNO_API_BASE_URL and SUNO_API_KEY are required when SUNO_PROVIDER=http",
    );
  }

  return new HttpSunoProvider({
    baseUrl: config.sunoApiBaseUrl,
    apiKey: config.sunoApiKey,
  });
}
