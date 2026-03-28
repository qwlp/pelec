import type {
  AuthStartResult,
  AuthSubmission,
  ChatMessage,
  OutgoingAttachmentDocument,
  ResolvedDocument,
  ChatSummary,
  Connector,
  ConnectorUpdateEvent,
  ConnectorStatus,
} from '../../shared/connectors';
import type { AppConfig, NetworkDefinition, NetworkId } from '../../shared/types';
import { InstagramConnector } from './instagramConnector';
import { TelegramConnector } from './telegramConnector';

export class ConnectorManager {
  private readonly connectors = new Map<NetworkId, Connector>();
  private readonly updateListeners = new Set<(event: ConnectorUpdateEvent) => void>();

  constructor(private readonly config: AppConfig, private readonly userDataPath: string) {
    for (const network of config.networks) {
      const connector = this.createConnector(network);
      this.connectors.set(network.id, connector);
      connector.onUpdate?.((event) => {
        for (const listener of this.updateListeners) {
          listener(event);
        }
      });
    }
  }

  async initAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.connectors.values()).map(async (connector) => {
        await connector.init();
      }),
    );
  }

  async shutdownAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.connectors.values()).map(async (connector) => {
        if (!connector.shutdown) {
          return;
        }
        await connector.shutdown();
      }),
    );
  }

  getAllStatuses(): ConnectorStatus[] {
    return this.config.networks.map((network) => this.getConnector(network.id).getStatus());
  }

  async startAuth(network: NetworkId): Promise<AuthStartResult> {
    return this.getConnector(network).startAuth();
  }

  async submitAuth(network: NetworkId, payload: AuthSubmission): Promise<ConnectorStatus> {
    return this.getConnector(network).submitAuth(payload);
  }

  async resetAuth(network: NetworkId): Promise<ConnectorStatus> {
    const connector = this.getConnector(network);
    if (!connector.resetAuth) {
      return connector.getStatus();
    }
    return connector.resetAuth();
  }

  async listChats(network: NetworkId): Promise<ChatSummary[]> {
    const connector = this.getConnector(network);
    if (!connector.listChats) {
      return [];
    }
    return connector.listChats();
  }

  async listMessages(network: NetworkId, chatId: string): Promise<ChatMessage[]> {
    const connector = this.getConnector(network);
    if (!connector.listMessages) {
      return [];
    }
    return connector.listMessages(chatId);
  }

  async setActiveChat(network: NetworkId, chatId?: string | null): Promise<void> {
    const connector = this.getConnector(network);
    if (!connector.setActiveChat) {
      return;
    }
    await connector.setActiveChat(chatId);
  }

  async resolveAudioUrl(
    network: NetworkId,
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> {
    const connector = this.getConnector(network);
    if (!connector.resolveAudioUrl) {
      return undefined;
    }
    return connector.resolveAudioUrl(chatId, messageId);
  }

  async resolveVideoUrl(
    network: NetworkId,
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> {
    const connector = this.getConnector(network);
    if (!connector.resolveVideoUrl) {
      return undefined;
    }
    return connector.resolveVideoUrl(chatId, messageId);
  }

  async resolveDocument(
    network: NetworkId,
    chatId: string,
    messageId: string,
  ): Promise<ResolvedDocument | undefined> {
    const connector = this.getConnector(network);
    if (!connector.resolveDocument) {
      return undefined;
    }
    return connector.resolveDocument(chatId, messageId);
  }

  async sendMessage(
    network: NetworkId,
    chatId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.sendMessage) {
      return false;
    }
    return connector.sendMessage(chatId, text, replyToMessageId);
  }

  async sendImageMessage(
    network: NetworkId,
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.sendImageMessage) {
      return false;
    }
    return connector.sendImageMessage(chatId, dataUrl, caption, replyToMessageId);
  }

  async sendDocumentMessage(
    network: NetworkId,
    chatId: string,
    document: OutgoingAttachmentDocument,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.sendDocumentMessage) {
      return false;
    }
    return connector.sendDocumentMessage(chatId, document, caption, replyToMessageId);
  }

  async sendVoiceMessage(
    network: NetworkId,
    chatId: string,
    document: OutgoingAttachmentDocument,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.sendVoiceMessage) {
      return false;
    }
    return connector.sendVoiceMessage(chatId, document, replyToMessageId);
  }

  async forwardMessage(
    network: NetworkId,
    fromChatId: string,
    toChatId: string,
    messageId: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.forwardMessage) {
      return false;
    }
    return connector.forwardMessage(fromChatId, toChatId, messageId);
  }

  async deleteMessage(network: NetworkId, chatId: string, messageId: string): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.deleteMessage) {
      return false;
    }
    return connector.deleteMessage(chatId, messageId);
  }

  onConnectorUpdate(handler: (event: ConnectorUpdateEvent) => void): () => void {
    this.updateListeners.add(handler);
    return () => {
      this.updateListeners.delete(handler);
    };
  }

  private getConnector(network: NetworkId): Connector {
    const connector = this.connectors.get(network);
    if (!connector) {
      throw new Error(`Connector not found for network: ${network}`);
    }
    return connector;
  }

  private createConnector(network: NetworkDefinition): Connector {
    if (network.id === 'telegram') {
      return new TelegramConnector(network, this.userDataPath);
    }

    if (network.id === 'instagram') {
      return new InstagramConnector(network, this.userDataPath);
    }

    throw new Error(`Unsupported network: ${network.id as string}`);
  }
}
