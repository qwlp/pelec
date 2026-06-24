import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { UserConfig } from '../../../shared/types';
import { applyUserTheme } from '../../lib/theme';

interface SettingsDialogProps {
  config: UserConfig;
  onClose(): void;
  onOpenConfigFile(): void;
  onSave(config: UserConfig): Promise<void>;
}

const cloneConfig = (config: UserConfig): UserConfig => structuredClone(config);
const serializeConfig = (config: UserConfig): string => JSON.stringify(config);
const AUTO_SAVE_DELAY_MS = 300;

const FontFamilyPicker = ({
  fonts,
  loading,
  value,
  onChange,
}: {
  fonts: string[];
  loading: boolean;
  value: string;
  onChange(value: string): void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => {
    const available = fonts.includes(value) ? fonts : [value, ...fonts];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? available.filter((font) => font.toLocaleLowerCase().includes(normalizedQuery))
      : available;
  }, [fonts, query, value]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  return (
    <div className="settings-font-picker" ref={rootRef}>
      <button
        aria-controls="settings-font-options"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Font family"
        className="settings-font-trigger"
        id="settings-font-family"
        onClick={() => setOpen((current) => !current)}
        role="combobox"
        type="button"
      >
        <span className="settings-font-trigger-label" style={{ fontFamily: value }} title={value}>
          {value}
        </span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>

      {open ? (
        <div className="settings-font-popover">
          <div className="settings-font-search">
            <Search aria-hidden="true" size={13} />
            <input
              aria-label="Search installed fonts"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder="Search fonts"
              type="search"
              value={query}
            />
          </div>
          <div
            aria-label="Installed fonts"
            className="settings-font-options"
            id="settings-font-options"
            role="listbox"
          >
            {options.length > 0 ? options.map((font) => (
              <button
                aria-label={font}
                aria-selected={font === value}
                className={`settings-font-option${font === value ? ' selected' : ''}`}
                key={font}
                onClick={() => {
                  onChange(font);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span className="settings-font-preview" style={{ fontFamily: font }}>Aa</span>
                <span className="settings-font-name">{font}</span>
                {font === value ? <Check aria-hidden="true" size={13} /> : null}
              </button>
            )) : (
              <div className="settings-font-empty">
                {loading ? 'Loading fonts…' : 'No matching fonts'}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const SettingsDialog = ({
  config,
  onClose,
  onOpenConfigFile,
  onSave,
}: SettingsDialogProps) => {
  const [draft, setDraft] = useState(() => cloneConfig(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(true);
  const mountedRef = useRef(true);
  const onSaveRef = useRef(onSave);
  const draftRef = useRef(draft);
  const lastQueuedConfigRef = useRef(serializeConfig(config));
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);

  onSaveRef.current = onSave;
  draftRef.current = draft;

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    applyUserTheme(draft);
  }, [draft]);

  const queueSave = useCallback((nextConfig: UserConfig) => {
    const serializedConfig = serializeConfig(nextConfig);
    if (serializedConfig === lastQueuedConfigRef.current) {
      return saveQueueRef.current;
    }

    const configSnapshot = cloneConfig(nextConfig);
    lastQueuedConfigRef.current = serializedConfig;
    pendingSaveCountRef.current += 1;
    setSaving(true);
    setError('');

    const save = saveQueueRef.current
      .catch((): void => undefined)
      .then(() => onSaveRef.current(configSnapshot));
    saveQueueRef.current = save;

    void save
      .catch((reason) => {
        if (mountedRef.current) {
          setError(reason instanceof Error ? reason.message : 'Could not save settings.');
        }
      })
      .finally(() => {
        pendingSaveCountRef.current -= 1;
        if (mountedRef.current && pendingSaveCountRef.current === 0) {
          setSaving(false);
        }
      });

    return save;
  }, []);

  useEffect(() => {
    if (serializeConfig(draft) === lastQueuedConfigRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void queueSave(draft);
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [draft, queueSave]);

  useEffect(() => {
    let cancelled = false;

    void window.pelec.listInstalledFonts()
      .then((fonts) => {
        if (!cancelled) {
          setInstalledFonts(fonts);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInstalledFonts([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingFonts(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    void queueSave(draftRef.current);
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
            <div className="settings-field settings-field-wide">
              <label htmlFor="settings-font-family">Font family</label>
              <FontFamilyPicker
                fonts={installedFonts}
                loading={loadingFonts}
                value={draft.appearance.fontFamily}
                onChange={(font) => updateAppearance('fontFamily', font)}
              />
              <small className="settings-field-detail">
                {loadingFonts
                  ? 'Loading installed fonts…'
                  : `${installedFonts.length} installed font${installedFonts.length === 1 ? '' : 's'}`}
              </small>
            </div>
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
              ['enableVimMode', 'Vim mode in composer', 'Use Normal, Insert, and Visual modes while composing messages.'],
              ['enableCounts', 'Vim-style counts', 'Allow commands such as 5j.'],
              ['captureInWebview', 'Capture webview keys', 'Apply shortcuts inside embedded pages.'],
            ] as const).map(([key, label, detail]) => (
              <label className="settings-toggle" key={key}>
                <span title={detail}>{label}</span>
                <input
                  type="checkbox"
                  checked={draft.keyboard[key]}
                  disabled={key === 'enableCounts' && !draft.keyboard.enableVimMode}
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
          <span className="settings-save-status" role="status">
            {saving ? 'Saving…' : 'Settings save automatically'}
          </span>
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
