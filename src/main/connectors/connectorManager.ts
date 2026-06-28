import type {
  AuthStartResult,
  AuthSubmission,
  ChatMessage,
  ConnectorProfile,
  ConnectorProfileUpdate,
  ListMessagesOptions,
  OutgoingAttachmentDocument,
  ResolvedDocument,
  ChatSummary,
  Connector,
  ConnectorUpdateEvent,
  ConnectorStatus,
  TelegramPickerItem,
  TelegramPickerQuery,
  TelegramCallDevice,
  TelegramCallState,
  TelegramCallUpdate,
  TelegramCallVideoFrame,
  TelegramStickerSetSource,
  TelegramStickerSetSummary,
} from '../../shared/connectors';
import type { AppConfig, NetworkDefinition, NetworkId } from '../../shared/types';
import { TelegramConnector } from './telegramConnector';

export class ConnectorManager {
  private readonly connectors = new Map<NetworkId, Connector>();
  private readonly updateListeners = new Set<(event: ConnectorUpdateEvent) => void>();
  private readonly telegramCallUpdateListeners = new Set<
    (event: TelegramCallUpdate) => void
  >();
  private readonly telegramCallVideoFrameListeners = new Set<
    (frame: TelegramCallVideoFrame) => void
  >();

  constructor(private readonly config: AppConfig, private readonly userDataPath: string) {
    for (const network of config.networks) {
      const connector = this.createConnector(network);
      this.connectors.set(network.id, connector);
      connector.onUpdate?.((event) => {
        for (const listener of this.updateListeners) {
          listener(event);
        }
      });
      connector.onTelegramCallUpdate?.((event) => {
        for (const listener of this.telegramCallUpdateListeners) {
          listener(event);
        }
      });
      connector.onTelegramCallVideoFrame?.((frame) => {
        for (const listener of this.telegramCallVideoFrameListeners) {
          listener(frame);
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

  async getProfile(network: NetworkId): Promise<ConnectorProfile | null> {
    const connector = this.getConnector(network);
    if (!connector.getProfile) {
      return null;
    }
    return connector.getProfile();
  }

  async updateProfile(
    network: NetworkId,
    profile: ConnectorProfileUpdate,
  ): Promise<ConnectorProfile | null> {
    const connector = this.getConnector(network);
    if (!connector.updateProfile) {
      return null;
    }
    return connector.updateProfile(profile);
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

  async listMessages(
    network: NetworkId,
    chatId: string,
    options?: ListMessagesOptions,
  ): Promise<ChatMessage[]> {
    const connector = this.getConnector(network);
    if (!connector.listMessages) {
      return [];
    }
    return connector.listMessages(chatId, options);
  }

  async markChatRead(
    network: NetworkId,
    chatId: string,
    messageIds?: string[],
  ): Promise<void> {
    const connector = this.getConnector(network);
    if (!connector.markChatRead) {
      return;
    }
    await connector.markChatRead(chatId, messageIds);
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

  async resolveImageUrl(
    network: NetworkId,
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> {
    const connector = this.getConnector(network);
    if (!connector.resolveImageUrl) {
      return undefined;
    }
    return connector.resolveImageUrl(chatId, messageId);
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

  async answerPoll(
    network: NetworkId,
    chatId: string,
    messageId: string,
    optionIds: number[],
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.answerPoll) {
      return false;
    }
    return connector.answerPoll(chatId, messageId, optionIds);
  }

  async addPollOption(
    network: NetworkId,
    chatId: string,
    messageId: string,
    text: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.addPollOption) {
      return false;
    }
    return connector.addPollOption(chatId, messageId, text);
  }

  async listTelegramStickerSets(
    network: NetworkId,
    source: TelegramStickerSetSource,
  ): Promise<TelegramStickerSetSummary[]> {
    const connector = this.getConnector(network);
    if (!connector.listTelegramStickerSets) {
      return [];
    }
    return connector.listTelegramStickerSets(source);
  }

  async listTelegramPickerItems(
    network: NetworkId,
    query: TelegramPickerQuery,
  ): Promise<TelegramPickerItem[]> {
    const connector = this.getConnector(network);
    if (!connector.listTelegramPickerItems) {
      return [];
    }
    return connector.listTelegramPickerItems(query);
  }

  async sendTelegramPickerItem(
    network: NetworkId,
    chatId: string,
    item: TelegramPickerItem,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.sendTelegramPickerItem) {
      return false;
    }
    return connector.sendTelegramPickerItem(chatId, item, replyToMessageId);
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

  async editMessage(
    network: NetworkId,
    chatId: string,
    messageId: string,
    text: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.editMessage) {
      return false;
    }
    return connector.editMessage(chatId, messageId, text);
  }

  async setReaction(
    network: NetworkId,
    chatId: string,
    messageId: string,
    reaction: string,
  ): Promise<boolean> {
    const connector = this.getConnector(network);
    if (!connector.setReaction) {
      return false;
    }
    return connector.setReaction(chatId, messageId, reaction);
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

  async getTelegramCallState(): Promise<TelegramCallState> {
    return (
      (await this.getConnector('telegram').getTelegramCallState?.()) ?? {
        session: null,
        participants: [],
        devices: [],
        metrics: {},
      }
    );
  }

  async startTelegramCall(chatId: string, isVideo: boolean): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.startTelegramCall) {
      throw new Error('Telegram calls are unavailable.');
    }
    return connector.startTelegramCall(chatId, isVideo);
  }

  async answerTelegramCall(isVideo: boolean): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.answerTelegramCall) {
      throw new Error('Telegram calls are unavailable.');
    }
    return connector.answerTelegramCall(isVideo);
  }

  async declineTelegramCall(): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    return connector.declineTelegramCall?.() ?? this.getTelegramCallState();
  }

  async hangUpTelegramCall(): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    return connector.hangUpTelegramCall?.() ?? this.getTelegramCallState();
  }

  async joinTelegramGroupCall(chatId: string, isVideo: boolean): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.joinTelegramGroupCall) {
      throw new Error('Telegram group calls are unavailable.');
    }
    return connector.joinTelegramGroupCall(chatId, isVideo);
  }

  async leaveTelegramGroupCall(): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    return connector.leaveTelegramGroupCall?.() ?? this.getTelegramCallState();
  }

  async setTelegramCallMuted(muted: boolean): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.setTelegramCallMuted) {
      throw new Error('Telegram calls are unavailable.');
    }
    return connector.setTelegramCallMuted(muted);
  }

  async setTelegramCallVideoEnabled(enabled: boolean): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.setTelegramCallVideoEnabled) {
      throw new Error('Telegram video calls are unavailable.');
    }
    return connector.setTelegramCallVideoEnabled(enabled);
  }

  async setTelegramCallDevice(
    kind: TelegramCallDevice['kind'],
    deviceId: string,
  ): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.setTelegramCallDevice) {
      throw new Error('Telegram call devices are unavailable.');
    }
    return connector.setTelegramCallDevice(kind, deviceId);
  }

  async setTelegramParticipantVolume(
    participantId: string,
    volume: number,
  ): Promise<TelegramCallState> {
    const connector = this.getConnector('telegram');
    if (!connector.setTelegramParticipantVolume) {
      throw new Error('Telegram participant controls are unavailable.');
    }
    return connector.setTelegramParticipantVolume(participantId, volume);
  }

  async setTelegramVisibleVideoEndpoints(endpointIds: string[]): Promise<void> {
    await this.getConnector('telegram').setTelegramVisibleVideoEndpoints?.(endpointIds);
  }

  onConnectorUpdate(handler: (event: ConnectorUpdateEvent) => void): () => void {
    this.updateListeners.add(handler);
    return () => {
      this.updateListeners.delete(handler);
    };
  }

  onTelegramCallUpdate(handler: (event: TelegramCallUpdate) => void): () => void {
    this.telegramCallUpdateListeners.add(handler);
    return () => this.telegramCallUpdateListeners.delete(handler);
  }

  onTelegramCallVideoFrame(handler: (frame: TelegramCallVideoFrame) => void): () => void {
    this.telegramCallVideoFrameListeners.add(handler);
    return () => this.telegramCallVideoFrameListeners.delete(handler);
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
      return new TelegramConnector(network, this.userDataPath, this.config.userConfig.telegram);
    }

    throw new Error(`Unsupported network: ${network.id as string}`);
  }
}
