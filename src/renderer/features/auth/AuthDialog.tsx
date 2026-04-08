import { useEffect, useRef, useState } from 'react';
import type { LegacyAuthPromptState } from '../../legacyBridge';

interface AuthDialogProps {
  prompt: LegacyAuthPromptState;
  onCancel(): void;
  onSubmit(value: string): void;
}

export const AuthDialog = ({ prompt, onCancel, onSubmit }: AuthDialogProps) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue('');
  }, [prompt.label, prompt.message, prompt.placeholder, prompt.secret, prompt.stepLabel, prompt.submitLabel, prompt.title]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [prompt.label, prompt.message, prompt.placeholder, prompt.secret, prompt.stepLabel, prompt.submitLabel, prompt.title]);

  return (
    <div className="qr-modal" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="qr-card">
        {prompt.stepLabel ? <div className="auth-step">{prompt.stepLabel}</div> : null}
        <h3>{prompt.title}</h3>
        <p className="qr-subtitle">{prompt.message}</p>
        <label className="auth-label" htmlFor="auth-dialog-input">
          {prompt.label}
        </label>
        <div className="auth-input-shell">
          <input
            id="auth-dialog-input"
            ref={inputRef}
            className="quick-filter auth-input"
            type={prompt.secret ? 'password' : 'text'}
            placeholder={prompt.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit(value);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <div className="qr-actions">
          <button type="button" className="ghost-button" onClick={() => onSubmit(value)}>
            {prompt.submitLabel}
          </button>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
