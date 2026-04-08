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
    chat.lastMessagePreview,
    chat.lastMessageTimestamp ?? '',
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
  preview.textContent = chatPreview;
  const status = document.createElement('div');
  status.className = 'telegram-chat-status';

  if (unreadCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'telegram-chat-unread-badge';
    badge.textContent = deps.formatTelegramUnreadBadge(unreadCount);
    badge.title = `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`;
    status.append(badge);
  } else {
    const readDot = document.createElement('span');
    readDot.className = 'telegram-chat-read-dot';
    readDot.title = 'No unread messages';
    status.append(readDot);
  }

  top.replaceChildren(name, date);
  bottom.replaceChildren(preview, status);
  content.replaceChildren(top, bottom);
  button.replaceChildren(avatar, content);
  button.addEventListener('click', deps.onClick);

  return button;
};
