import type { ChatMessage } from "@monkey-radio/shared";

export class ChatBuffer {
  private messages: ChatMessage[] = [];

  constructor(private readonly windowMs: number) {}

  add(messages: ChatMessage[]): void {
    if (messages.length === 0) return;
    const existingIds = new Set(this.messages.map((message) => message.id));
    const novel = messages.filter((message) => !existingIds.has(message.id));
    if (novel.length === 0) return;
    this.messages.push(...novel);
    this.prune();
  }

  getRecent(windowMs = this.windowMs): ChatMessage[] {
    this.prune(windowMs);
    return [...this.messages];
  }

  snapshot(): string {
    return JSON.stringify(this.getRecent());
  }

  private prune(windowMs = this.windowMs): void {
    const cutoff = Date.now() - windowMs;
    this.messages = this.messages.filter(
      (message) => new Date(message.timestamp).getTime() >= cutoff,
    );
  }
}
