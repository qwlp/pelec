export class TelegramController {
  private chatsRefreshPromise: Promise<void> | null = null;

  private messageRefreshPromiseByChat = new Map<string, Promise<void>>();

  private chatsRequestSeq = 0;

  private messagesRequestSeq = 0;

  beginChatsRequest(): number {
    this.chatsRequestSeq += 1;
    return this.chatsRequestSeq;
  }

  isCurrentChatsRequest(requestSeq: number): boolean {
    return requestSeq === this.chatsRequestSeq;
  }

  beginMessagesRequest(): number {
    this.messagesRequestSeq += 1;
    return this.messagesRequestSeq;
  }

  isCurrentMessagesRequest(requestSeq: number): boolean {
    return requestSeq === this.messagesRequestSeq;
  }

  refreshChats(run: () => Promise<void>): Promise<void> {
    if (!this.chatsRefreshPromise) {
      this.chatsRefreshPromise = run().finally(() => {
        this.chatsRefreshPromise = null;
      });
    }

    return this.chatsRefreshPromise;
  }

  refreshMessages(chatId: string, run: () => Promise<void>): Promise<void> {
    const existing = this.messageRefreshPromiseByChat.get(chatId);
    if (existing) {
      return existing;
    }

    const nextPromise = run().finally(() => {
      if (this.messageRefreshPromiseByChat.get(chatId) === nextPromise) {
        this.messageRefreshPromiseByChat.delete(chatId);
      }
    });

    this.messageRefreshPromiseByChat.set(chatId, nextPromise);
    return nextPromise;
  }

  clearMessageRefresh(chatId?: string): void {
    if (chatId) {
      this.messageRefreshPromiseByChat.delete(chatId);
      return;
    }

    this.messageRefreshPromiseByChat.clear();
  }
}
