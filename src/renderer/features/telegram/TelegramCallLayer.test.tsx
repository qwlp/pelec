import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramCallState, TelegramCallUpdate } from '../../../shared/connectors';
import { installDom } from '../../test/dom';
import { TelegramCallLayer } from './TelegramCallLayer';

const emptyState: TelegramCallState = {
  session: null,
  participants: [],
  devices: [],
  metrics: {},
};

describe('TelegramCallLayer', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
    vi.restoreAllMocks();
  });

  it('renders private call actions in the chat header and starts a voice call', async () => {
    const header = document.createElement('div');
    document.body.append(header);
    const startTelegramCall = vi.fn(async () => emptyState);
    window.pelec = {
      getTelegramCallState: async () => emptyState,
      onTelegramCallUpdate: () => (): void => undefined,
      onTelegramCallVideoFrame: () => (): void => undefined,
      startTelegramCall,
    } as unknown as typeof window.pelec;

    render(
      <TelegramCallLayer
        activeChatId="100"
        capabilities={{ callable: true, supportsVideo: true }}
        headerTarget={header}
      />,
    );

    await waitFor(() =>
      expect(
        within(header).getByRole('button', { name: 'Start Telegram voice call' }),
      ).not.toBeNull(),
    );
    fireEvent.click(
      within(header).getByRole('button', { name: 'Start Telegram voice call' }),
    );
    await waitFor(() => expect(startTelegramCall).toHaveBeenCalledWith('100', false));
    expect(
      within(header).getByRole('button', { name: 'Start Telegram video call' }),
    ).not.toBeNull();
  });

  it('shows incoming answer and decline controls from call updates', async () => {
    let updateHandler: ((update: TelegramCallUpdate) => void) | null = null;
    window.pelec = {
      getTelegramCallState: async () => emptyState,
      onTelegramCallUpdate: (handler: (update: TelegramCallUpdate) => void) => {
        updateHandler = handler;
        return () => {
          updateHandler = null;
        };
      },
      onTelegramCallVideoFrame: () => (): void => undefined,
    } as unknown as typeof window.pelec;

    render(
      <TelegramCallLayer activeChatId={null} capabilities={undefined} headerTarget={null} />,
    );
    await waitFor(() => expect(updateHandler).not.toBeNull());
    act(() => {
      updateHandler?.({
        kind: 'session',
        session: {
          sessionId: 'call-1',
          kind: 'private',
          peerLabel: 'Ada',
          direction: 'incoming',
          isVideo: true,
          phase: 'ringing',
          durationSeconds: 0,
          microphoneMuted: false,
          cameraEnabled: false,
          encryptionEmojis: [],
        },
      });
    });

    const body = within(document.body);
    expect(body.getByRole('dialog').textContent).toContain('Ada');
    expect(body.getByRole('button', { name: 'Answer voice call' })).not.toBeNull();
    expect(body.getByRole('button', { name: 'Answer video call' })).not.toBeNull();
    expect(body.getByRole('button', { name: 'Decline call' })).not.toBeNull();
  });
});
