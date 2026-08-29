import type { KeyboardActionId, ShortcutConfig } from '../../../shared/types';
import { resolveActionBinding } from '../../keyboard/keymap';

const HELP_ROWS: Array<{ actionId: KeyboardActionId; description: string }> = [
  { actionId: 'moveDown', description: 'Move selection down' },
  { actionId: 'moveUp', description: 'Move selection up' },
  { actionId: 'moveLeft', description: 'Move to previous pane' },
  { actionId: 'moveRight', description: 'Move to next pane' },
  { actionId: 'moveToTop', description: 'Jump to the first item' },
  { actionId: 'moveToBottom', description: 'Jump to the last item' },
  { actionId: 'movePageUp', description: 'Move up by a page' },
  { actionId: 'movePageDown', description: 'Move down by a page' },
  { actionId: 'focusSearch', description: 'Focus search for the active pane' },
  { actionId: 'openCommandPalette', description: 'Open the command palette' },
  { actionId: 'openKeyboardHelp', description: 'Toggle keyboard help' },
  { actionId: 'toggleInsertMode', description: 'Enter compose mode' },
  { actionId: 'activateSelection', description: 'Open or activate the current selection' },
  { actionId: 'reply', description: 'Reply to the selected Telegram message' },
  { actionId: 'refresh', description: 'Refresh the active network' },
  { actionId: 'startAuth', description: 'Start auth for the active network' },
  { actionId: 'openBrowser', description: 'Open the active network in the browser' },
  { actionId: 'switchTelegram', description: 'Switch to Telegram' },
];

interface KeyboardHelpDialogProps {
  customKeymap: Partial<Record<KeyboardActionId, string>>;
  onClose(): void;
  shortcuts: ShortcutConfig;
}

export const KeyboardHelpDialog = ({
  customKeymap,
  onClose,
  shortcuts,
}: KeyboardHelpDialogProps) => {
  return (
    <div className="modern-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modern-keyboard-help"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modern-keyboard-help-header">
          <h2>Keyboard Shortcuts</h2>
          <button type="button" className="modern-close-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modern-keyboard-grid">
          {HELP_ROWS.map((row) => (
            <div key={row.actionId} className="modern-keyboard-row">
              <span className="modern-keyboard-binding">
                {resolveActionBinding(row.actionId, customKeymap, shortcuts)}
              </span>
              <span className="modern-keyboard-label">{row.description}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
