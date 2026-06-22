import type { ChatSummary } from '../../../shared/connectors';

export interface TelegramChatListRenderDeps {
  createAvatarNode: (label: string, imageUrl: string | undefined, className: string) => HTMLElement;
  formatChatTimestamp: (timestamp?: number) => string;
  formatFullDateTime: (timestamp: number) => string;
  formatTelegramUnreadBadge: (count: number) => string;
  hasValidTimestamp: (timestamp?: number) => boolean;
  onClick: () => void;
  safeLabel: (value: string | null | undefined, fallback: string) => string;
  safeText: (value: string | null | undefined) => string;
}

export const getTelegramChatRenderSignature = (chat: ChatSummary): string =>
  [
    chat.id,
    chat.title,
    chat.lastMessageSender ?? '',
    chat.lastMessagePreview,
    chat.lastMessageTimestamp ?? '',
    chat.lastMessageOutgoing ? '1' : '0',
    chat.lastMessageReadByPeer ? '1' : '0',
    chat.unreadCount,
    chat.avatarUrl ?? '',
    chat.isMuted ? '1' : '0',
  ].join('::');

export const createTelegramChatListItem = (
  chat: ChatSummary,
  deps: TelegramChatListRenderDeps,
): HTMLButtonElement => {
  const chatTitle = deps.safeLabel(chat.title, 'Untitled chat');
  const chatPreview = deps.safeText(chat.lastMessagePreview).trim() || 'No preview';
  const chatPreviewSender = deps.safeText(chat.lastMessageSender).trim();
  const unreadCount = Math.max(0, Math.floor(chat.unreadCount));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'telegram-chat-item';
  button.classList.toggle('unread', unreadCount > 0);
  button.classList.toggle('read', unreadCount < 1);
  button.classList.toggle('muted', chat.isMuted === true);

  const avatar = deps.createAvatarNode(chatTitle, chat.avatarUrl, 'telegram-avatar');
  const content = document.createElement('div');
  content.className = 'telegram-chat-content';
  const top = document.createElement('div');
  top.className = 'telegram-chat-top';
  const bottom = document.createElement('div');
  bottom.className = 'telegram-chat-bottom';
  const name = document.createElement('div');
  name.className = 'telegram-chat-name';
  name.textContent = chatTitle;
  const date = document.createElement('div');
  date.className = 'telegram-chat-date';
  date.textContent = deps.formatChatTimestamp(chat.lastMessageTimestamp);
  if (deps.hasValidTimestamp(chat.lastMessageTimestamp)) {
    date.title = deps.formatFullDateTime(chat.lastMessageTimestamp as number);
  }
  const preview = document.createElement('div');
  preview.className = 'telegram-chat-preview';
  if (chatPreviewSender) {
    const sender = document.createElement('span');
    sender.className = 'telegram-chat-preview-sender';
    sender.textContent = `${chatPreviewSender}: `;
    preview.append(sender);
  }
  const previewText = document.createElement('span');
  previewText.className = 'telegram-chat-preview-text';
  previewText.textContent = chatPreview;
  preview.append(previewText);
  const status = document.createElement('div');
  status.className = 'telegram-chat-status';

  if (unreadCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'telegram-chat-unread-badge';
    badge.textContent = deps.formatTelegramUnreadBadge(unreadCount);
    badge.title = `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`;
    status.append(badge);
  } else if (chat.lastMessageOutgoing) {
    const receipt = document.createElement('span');
    receipt.className = `telegram-chat-receipt ${chat.lastMessageReadByPeer ? 'read' : 'sent'}`;
    receipt.title = chat.lastMessageReadByPeer ? 'Read' : 'Sent';
    const tick = document.createElement('span');
    tick.className = `telegram-chat-tick${chat.lastMessageReadByPeer ? ' double' : ''}`;
    tick.setAttribute('aria-label', chat.lastMessageReadByPeer ? 'Read' : 'Sent');
    tick.textContent = chat.lastMessageReadByPeer ? '✓✓' : '✓';
    receipt.append(tick);
    status.append(receipt);
  }

  top.replaceChildren(name, date);
  bottom.replaceChildren(preview, status);
  content.replaceChildren(top, bottom);
  button.replaceChildren(avatar, content);
  button.addEventListener('click', deps.onClick);

  return button;
};
