#!/usr/bin/env node
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadBroadcastWorkerConfig,
  openDatabase,
  resolveBroadcastConfigPaths,
} from "@monkey-radio/shared";
import { runBroadcastLoop } from "./broadcast-loop.js";
import { ChatBuffer } from "./chat/buffer.js";
import { startChatPoller } from "./chat/poller.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env"), override: true });

const appConfig = resolveBroadcastConfigPaths(loadBroadcastWorkerConfig(), repoRoot);
const db = openDatabase(appConfig.databasePath);
const chatBuffer = new ChatBuffer(appConfig.chatWindowMs);
const chatPoller = startChatPoller(appConfig, db, chatBuffer);

process.on("SIGINT", () => {
  chatPoller.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  chatPoller.stop();
  process.exit(0);
});

runBroadcastLoop(db, appConfig, chatBuffer).catch((error: unknown) => {
  chatPoller.stop();
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
