import type { ChatMessage } from '../../../shared/connectors';

type RenderableTelegramMessage = ChatMessage & { pendingState?: 'sending' };

interface TelegramVoiceNoteDeps {
  buildVoiceBarHeights: (seed: string) => number[];
  formatDuration: (durationSeconds: number) => string;
  message: RenderableTelegramMessage;
  messageId: string;
  renderChatId: string | null;
  resolveTelegramAudioUrl: (chatId: string, messageId: string) => Promise<string | undefined>;
}

interface TelegramDocumentCardDeps {
  chatId: string | null;
  copyTelegramDocument: (
    chatId: string,
    message: RenderableTelegramMessage,
    button: HTMLButtonElement,
  ) => Promise<void>;
  downloadTelegramDocument: (
    chatId: string,
    message: RenderableTelegramMessage,
    button: HTMLButtonElement,
  ) => Promise<void>;
  formatTelegramDocumentKind: (fileName: string, mimeType?: string) => string;
  formatTelegramDocumentSubtitle: (
    fileName: string,
    mimeType?: string,
    sizeBytes?: number,
  ) => string;
  message: RenderableTelegramMessage;
  safeLabel: (value: string | null | undefined, fallback: string) => string;
}

interface TelegramMessageFooterDeps {
  formatFullDateTime: (timestamp: number) => string;
  formatMessageTimestamp: (timestamp?: number) => string;
  hasValidTimestamp: (timestamp?: number) => boolean;
  isPendingTelegramMessage: (message: RenderableTelegramMessage) => boolean;
  message: RenderableTelegramMessage;
}

export const createTelegramVoiceNoteNodes = ({
  buildVoiceBarHeights,
  formatDuration,
  message,
  messageId,
  renderChatId,
  resolveTelegramAudioUrl,
}: TelegramVoiceNoteDeps): HTMLElement[] => {
  const voiceNote = document.createElement('div');
  voiceNote.className = 'telegram-voice-note';
  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'telegram-voice-play';
  const playIcon = document.createElement('span');
  playIcon.className = 'telegram-voice-play-icon telegram-voice-play-icon-play';
  playIcon.textContent = '▶';
  const pauseIcon = document.createElement('span');
  pauseIcon.className = 'telegram-voice-play-icon telegram-voice-play-icon-pause';
  pauseIcon.setAttribute('aria-hidden', 'true');
  playButton.replaceChildren(playIcon, pauseIcon);
  const wave = document.createElement('div');
  wave.className = 'telegram-voice-wave';
  const barHeights = buildVoiceBarHeights(messageId);
  for (const height of barHeights) {
    const bar = document.createElement('span');
    bar.style.height = `${height}%`;
    wave.append(bar);
  }
  const duration = document.createElement('div');
  duration.className = 'telegram-voice-duration';
  duration.textContent = formatDuration(message.audioDurationSeconds ?? 0);
  const audio = document.createElement('audio');
  audio.className = 'telegram-message-audio';
  audio.preload = 'none';
  let loading = false;

  const updatePlayState = (): void => {
    const isPlaying = !audio.paused && !audio.ended;
    playButton.classList.toggle('playing', isPlaying);
    voiceNote.classList.toggle('playing', isPlaying);
  };

  if (message.audioUrl) {
    const source = document.createElement('source');
    source.src = message.audioUrl;
    source.type = 'audio/ogg;codecs=opus';
    audio.replaceChildren(source);
  }

  const ensureAudioLoaded = async (): Promise<boolean> => {
    if (message.audioUrl) {
      return true;
    }
    if (loading || !renderChatId) {
      return false;
    }
    loading = true;
    playButton.disabled = true;
    voiceNote.classList.add('loading');
    const resolved = await resolveTelegramAudioUrl(renderChatId, messageId);
    loading = false;
    playButton.disabled = false;
    voiceNote.classList.remove('loading');
    if (!resolved) {
      duration.textContent = 'retry';
      return false;
    }
    message.audioUrl = resolved;
    const source = document.createElement('source');
    source.src = resolved;
    source.type = 'audio/ogg;codecs=opus';
    audio.replaceChildren(source);
    audio.load();
    return true;
  };

  playButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!message.audioUrl) {
      const loaded = await ensureAudioLoaded();
      if (!loaded) {
        return;
      }
    }
    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => {
      // Keep control state if autoplay policy blocks immediate playback.
    });
  });

  audio.addEventListener('play', updatePlayState);
  audio.addEventListener('pause', updatePlayState);
  audio.addEventListener('ended', updatePlayState);
  audio.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    duration.textContent = formatDuration(audio.duration);
  });

  voiceNote.replaceChildren(playButton, wave, duration);
  return [voiceNote, audio];
};

export const createTelegramDocumentCard = ({
  chatId,
  copyTelegramDocument,
  downloadTelegramDocument,
  formatTelegramDocumentKind,
  formatTelegramDocumentSubtitle,
  message,
  safeLabel,
}: TelegramDocumentCardDeps): HTMLElement => {
  const fileName = safeLabel(message.document?.fileName, 'Document');
  const documentKind = formatTelegramDocumentKind(fileName, message.document?.mimeType);
  const documentSubtitle = formatTelegramDocumentSubtitle(
    fileName,
    message.document?.mimeType,
    message.document?.sizeBytes,
  );
  const documentCard = document.createElement('section');
  documentCard.className = 'telegram-message-document';
  const documentTitle = [fileName, message.document?.mimeType].filter(Boolean).join('\n');
  if (documentTitle) {
    documentCard.title = documentTitle;
  }
  const main = document.createElement('div');
  main.className = 'telegram-message-document-main';
  const icon = document.createElement('div');
  icon.className = 'telegram-message-document-icon';
  icon.textContent = documentKind;
  const info = document.createElement('div');
  info.className = 'telegram-message-document-info';
  const name = document.createElement('div');
  name.className = 'telegram-message-document-title';
  name.textContent = fileName;
  name.title = fileName;
  const documentMeta = document.createElement('div');
  documentMeta.className = 'telegram-message-document-subtitle';
  documentMeta.textContent = documentSubtitle;
  if (message.document?.mimeType) {
    documentMeta.title = message.document.mimeType;
  }
  info.replaceChildren(name, documentMeta);
  const actions = document.createElement('div');
  actions.className = 'telegram-message-document-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'telegram-message-document-action';
  copyButton.textContent = 'Copy';
  copyButton.setAttribute('aria-label', `Copy ${fileName}`);
  copyButton.title = `Copy ${fileName}`;
  copyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!chatId) {
      return;
    }
    void copyTelegramDocument(chatId, message, copyButton);
  });
  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'telegram-message-document-action';
  downloadButton.textContent = 'Save';
  downloadButton.setAttribute('aria-label', `Download ${fileName}`);
  downloadButton.title = `Download ${fileName}`;
  downloadButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!chatId) {
      return;
    }
    void downloadTelegramDocument(chatId, message, downloadButton);
  });
  actions.replaceChildren(copyButton, downloadButton);
  main.replaceChildren(icon, info);
  documentCard.replaceChildren(main, actions);
  return documentCard;
};

export const createTelegramMessageReactions = (
  message: RenderableTelegramMessage,
  safeLabel: (value: string | null | undefined, fallback: string) => string,
): HTMLElement | null => {
  const messageReactions = message.reactions ?? [];
  if (messageReactions.length < 1) {
    return null;
  }

  const reactions = document.createElement('div');
  reactions.className = 'telegram-message-reactions';
  reactions.replaceChildren(
    ...messageReactions.map((reaction) => {
      const chip = document.createElement('span');
      chip.className = 'telegram-message-reaction';
      if (reaction.chosen) {
        chip.classList.add('chosen');
      }
      const value = document.createElement('span');
      value.className = 'telegram-message-reaction-value';
      value.textContent = safeLabel(reaction.value, '?');
      const count = document.createElement('span');
      count.className = 'telegram-message-reaction-count';
      count.textContent = String(reaction.count);
      chip.replaceChildren(value, count);
      return chip;
    }),
  );
  return reactions;
};

export const createTelegramMessageFooter = ({
  formatFullDateTime,
  formatMessageTimestamp,
  hasValidTimestamp,
  isPendingTelegramMessage,
  message,
}: TelegramMessageFooterDeps): HTMLElement => {
  const footer = document.createElement('div');
  footer.className = 'telegram-message-footer';
  const time = document.createElement('span');
  time.className = 'telegram-message-time';
  time.textContent = formatMessageTimestamp(message.timestamp);
  if (hasValidTimestamp(message.timestamp)) {
    time.title = formatFullDateTime(message.timestamp);
  }
  footer.append(time);
  if (message.outgoing) {
    const receipt = document.createElement('span');
    receipt.className = 'telegram-message-receipt';
    if (isPendingTelegramMessage(message)) {
      const spinner = document.createElement('span');
      spinner.className = 'telegram-message-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      receipt.classList.add('sending');
      receipt.title = 'Sending';
      receipt.append(spinner);
    } else {
      const tickSingle = document.createElement('span');
      tickSingle.className = 'telegram-message-tick';
      tickSingle.textContent = '✓';
      const tickDouble = document.createElement('span');
      tickDouble.className = 'telegram-message-tick';
      tickDouble.textContent = '✓';
      if (message.readByPeer) {
        receipt.classList.add('read');
        receipt.title = 'Read';
        receipt.append(tickSingle, tickDouble);
      } else {
        receipt.classList.add('sent');
        receipt.title = 'Sent';
        receipt.append(tickSingle);
      }
    }
    footer.append(receipt);
  }
  return footer;
};
