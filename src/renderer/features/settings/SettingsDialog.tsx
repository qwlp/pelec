import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { UserConfig } from '../../../shared/types';
import { applyUserTheme } from '../../lib/theme';

interface SettingsDialogProps {
  config: UserConfig;
  onClose(): void;
  onOpenConfigFile(): void;
  onSave(config: UserConfig): Promise<void>;
}

const cloneConfig = (config: UserConfig): UserConfig => structuredClone(config);

export const SettingsDialog = ({
  config,
  onClose,
  onOpenConfigFile,
  onSave,
}: SettingsDialogProps) => {
  const [draft, setDraft] = useState(() => cloneConfig(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    applyUserTheme(draft);
  }, [draft]);

  const updateAppearance = (
    key: keyof UserConfig['appearance'],
    value: string | number,
  ) => {
    setDraft((current) => ({
      ...current,
      appearance: { ...current.appearance, [key]: value },
    }));
  };

  const updateKeyboard = (key: keyof UserConfig['keyboard'], value: boolean | string) => {
    setDraft((current) => ({
      ...current,
      keyboard: { ...current.keyboard, [key]: value },
    }));
  };

  const close = () => {
    applyUserTheme(config);
    onClose();
  };

  return (
    <div className="modern-modal-backdrop settings-backdrop" role="presentation" onMouseDown={close}>
      <section
        aria-label="Settings"
        aria-modal="true"
        className="settings-panel"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2>Settings</h2>
          </div>
          <button className="settings-icon-button" type="button" aria-label="Close settings" onClick={close}>
            <X size={18} />
          </button>
        </header>

        <div className="settings-content">
          <section className="settings-section">
            <h3>Appearance</h3>
            <label className="settings-field settings-field-wide">
              <span>Font family</span>
              <input
                value={draft.appearance.fontFamily}
                onChange={(event) => updateAppearance('fontFamily', event.target.value)}
              />
            </label>
            {([
              ['fontSize', 'Font size', 10, 28, 1],
              ['windowPadding', 'Window padding', 0, 64, 1],
              ['backgroundOpacity', 'Background opacity', 0.4, 1, 0.05],
              ['textOpacity', 'Text opacity', 0.4, 1, 0.05],
            ] as const).map(([key, label, min, max, step]) => (
              <label className="settings-number-row" key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={draft.appearance[key]}
                  onChange={(event) => updateAppearance(key, Number(event.target.value))}
                />
              </label>
            ))}
          </section>

          <section className="settings-section">
            <h3>Behavior</h3>
            <div className="settings-field">
              <span>Send messages with</span>
              <div className="settings-choice" role="group" aria-label="Send messages with">
                <button
                  type="button"
                  className={draft.keyboard.sendBehavior === 'enter' ? 'active' : ''}
                  onClick={() => updateKeyboard('sendBehavior', 'enter')}
                >
                  Enter
                </button>
                <button
                  type="button"
                  className={draft.keyboard.sendBehavior === 'mod-enter' ? 'active' : ''}
                  onClick={() => updateKeyboard('sendBehavior', 'mod-enter')}
                >
                  Ctrl / Cmd + Enter
                </button>
              </div>
            </div>
            {([
              ['showHints', 'Show keyboard hints', 'Display contextual shortcut hints.'],
              ['enableCounts', 'Vim-style counts', 'Allow commands such as 5j.'],
              ['captureInWebview', 'Capture webview keys', 'Apply shortcuts inside embedded pages.'],
            ] as const).map(([key, label, detail]) => (
              <label className="settings-toggle" key={key}>
                <span title={detail}>{label}</span>
                <input
                  type="checkbox"
                  checked={draft.keyboard[key]}
                  onChange={(event) => updateKeyboard(key, event.target.checked)}
                />
              </label>
            ))}
            <label className="settings-toggle">
              <span>Select message text</span>
              <input
                type="checkbox"
                checked={draft.telegram.selectableMessageText}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  telegram: { ...current.telegram, selectableMessageText: event.target.checked },
                }))}
              />
            </label>
          </section>
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
        <footer className="settings-footer">
          <button className="settings-text-button" type="button" onClick={onOpenConfigFile}>
            Edit advanced config
          </button>
          <div>
            <button className="settings-text-button" type="button" onClick={() => setDraft(cloneConfig(config))}>
              <RotateCcw size={14} /> Reset changes
            </button>
            <button
              className="settings-save-button"
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setError('');
                void onSave(draft).catch((reason) => {
                  setError(reason instanceof Error ? reason.message : 'Could not save settings.');
                  setSaving(false);
                });
              }}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export const AboutDialog = ({
  version,
  onClose,
}: {
  version: string;
  onClose(): void;
}) => (
  <div className="modern-modal-backdrop settings-backdrop" role="presentation" onMouseDown={onClose}>
    <section
      aria-label="About PELEC"
      aria-modal="true"
      className="about-panel"
      role="dialog"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button className="settings-icon-button about-close" type="button" aria-label="Close about" onClick={onClose}>
        <X size={18} />
      </button>
      <span className="settings-eyebrow">PELEC</span>
      <h2>Messages, without the noise.</h2>
      <p>A focused desktop client built around keyboard-first navigation and a calm, compact interface.</p>
      <div className="about-version">Version {version}</div>
    </section>
  </div>
);
