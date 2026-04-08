import { AuthDialog } from '../features/auth/AuthDialog';
import { QrAuthDialog } from '../features/auth/QrAuthDialog';
import type { CommandPaletteItem } from '../features/commandPalette/CommandPalette';
import { CommandPalette } from '../features/commandPalette/CommandPalette';
import { TelegramContextMenu } from '../features/telegram/TelegramContextMenu';
import { TelegramForwardDialog } from '../features/telegram/TelegramForwardDialog';
import { TelegramImagePreviewDialog } from '../features/telegram/TelegramImagePreviewDialog';
import type {
  LegacyAuthPromptState,
  LegacyQrAuthState,
  LegacyTelegramContextMenuState,
  LegacyTelegramForwardState,
} from '../legacyBridge';

interface ModalLayerProps {
  commandItems: CommandPaletteItem[];
  commandPaletteOpen: boolean;
  commandQuery: string;
  authPrompt: LegacyAuthPromptState | null;
  qrAuth: LegacyQrAuthState | null;
  onCancelAuthPrompt(): void;
  onSubmitAuthPrompt(value: string): void;
  onCloseQrAuth(): void;
  onCloseCommandPalette(): void;
  onCommandQueryChange(query: string): void;
  onExecuteCommand(item: CommandPaletteItem): void;
  onSelectedIndexChange(index: number): void;
  selectedIndex: number;
  telegramContextMenu: LegacyTelegramContextMenuState | null;
  telegramForward: LegacyTelegramForwardState | null;
  telegramImagePreviewUrl: string | null;
  onCloseTelegramContextMenu(): void;
  onCloseTelegramForward(): void;
  onCloseTelegramImagePreview(): void;
  onCopyTelegramMessage(messageId: string): void;
  onCopyTelegramImagePreview(): void;
  onDownloadTelegramImagePreview(): void;
  onForwardTelegramMessage(chatId: string): void;
  onOpenTelegramForwardMenu(messageId: string): void;
  onReplyToTelegramMessage(messageId: string): void;
  onRefreshQrAuth(): void;
  onRevealQrPassword(): void;
  onSubmitQrPassword(value: string): void;
  onSelectTelegramMessage(messageId: string): void;
  onTelegramForwardQueryChange(query: string): void;
}

export const ModalLayer = ({
  commandItems,
  commandPaletteOpen,
  commandQuery,
  authPrompt,
  qrAuth,
  onCancelAuthPrompt,
  onSubmitAuthPrompt,
  onCloseQrAuth,
  onCloseCommandPalette,
  onCommandQueryChange,
  onExecuteCommand,
  onSelectedIndexChange,
  selectedIndex,
  telegramContextMenu,
  telegramForward,
  telegramImagePreviewUrl,
  onCloseTelegramContextMenu,
  onCloseTelegramForward,
  onCloseTelegramImagePreview,
  onCopyTelegramMessage,
  onCopyTelegramImagePreview,
  onDownloadTelegramImagePreview,
  onForwardTelegramMessage,
  onOpenTelegramForwardMenu,
  onReplyToTelegramMessage,
  onRefreshQrAuth,
  onRevealQrPassword,
  onSubmitQrPassword,
  onSelectTelegramMessage,
  onTelegramForwardQueryChange,
}: ModalLayerProps) => {
  if (
    !commandPaletteOpen &&
    !telegramImagePreviewUrl &&
    !telegramForward?.visible &&
    !telegramContextMenu?.visible &&
    !authPrompt?.visible &&
    !qrAuth?.visible
  ) {
    return null;
  }

  return (
    <>
      {qrAuth?.visible ? (
        <QrAuthDialog
          qrAuth={qrAuth}
          onClose={onCloseQrAuth}
          onRefresh={onRefreshQrAuth}
          onRevealPassword={onRevealQrPassword}
          onSubmitPassword={onSubmitQrPassword}
        />
      ) : null}
      {authPrompt?.visible ? (
        <AuthDialog
          prompt={authPrompt}
          onCancel={onCancelAuthPrompt}
          onSubmit={onSubmitAuthPrompt}
        />
      ) : null}
      {commandPaletteOpen ? (
        <CommandPalette
          items={commandItems}
          onClose={onCloseCommandPalette}
          onExecute={onExecuteCommand}
          onQueryChange={onCommandQueryChange}
          onSelectedIndexChange={onSelectedIndexChange}
          query={commandQuery}
          selectedIndex={selectedIndex}
        />
      ) : null}
      {telegramContextMenu?.visible && telegramContextMenu.messageId ? (
        <TelegramContextMenu
          messageId={telegramContextMenu.messageId}
          onClose={onCloseTelegramContextMenu}
          onCopy={onCopyTelegramMessage}
          onForward={onOpenTelegramForwardMenu}
          onReply={onReplyToTelegramMessage}
          onSelect={onSelectTelegramMessage}
          x={telegramContextMenu.x}
          y={telegramContextMenu.y}
        />
      ) : null}
      {telegramImagePreviewUrl ? (
        <TelegramImagePreviewDialog
          imageUrl={telegramImagePreviewUrl}
          onClose={onCloseTelegramImagePreview}
          onCopy={onCopyTelegramImagePreview}
          onDownload={onDownloadTelegramImagePreview}
        />
      ) : null}
      {telegramForward?.visible ? (
        <TelegramForwardDialog
          chats={telegramForward.candidates}
          onClose={onCloseTelegramForward}
          onForward={onForwardTelegramMessage}
          onQueryChange={onTelegramForwardQueryChange}
          query={telegramForward.query}
          sending={telegramForward.sending}
        />
      ) : null}
    </>
  );
};
