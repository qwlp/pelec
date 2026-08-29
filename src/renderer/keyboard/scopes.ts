import type { AppPane } from '../../shared/types';

export type KeyboardScope =
  | 'global'
  | 'networkRail'
  | 'telegramChats'
  | 'telegramMessages'
  | 'telegramComposer'
  | 'instagramChats'
  | 'instagramMessages'
  | 'commandPalette'
  | 'modal'
  | 'webview';

export const resolveKeyboardScope = (
  target: EventTarget | null,
  activePane: AppPane,
  commandPaletteOpen: boolean,
  keyboardHelpOpen: boolean,
): KeyboardScope => {
  if (keyboardHelpOpen) {
    return 'modal';
  }

  if (commandPaletteOpen) {
    return 'commandPalette';
  }

  const element = target as HTMLElement | null;
  if (element?.tagName === 'WEBVIEW') {
    return 'webview';
  }
  if (element?.id === 'telegram-compose-input') {
    return 'telegramComposer';
  }
  if (element?.closest('#telegram-message-list, .telegram-message-list')) {
    return 'telegramMessages';
  }
  if (element?.closest('#telegram-chat-list, .telegram-chat-list')) {
    return 'telegramChats';
  }

  switch (activePane) {
    case 'telegram-chats':
      return 'telegramChats';
    case 'telegram-messages':
      return 'telegramMessages';
    case 'instagram-chats':
      return 'instagramChats';
    case 'instagram-messages':
      return 'instagramMessages';
    case 'networks':
      return 'networkRail';
    default:
      return 'global';
  }
};
