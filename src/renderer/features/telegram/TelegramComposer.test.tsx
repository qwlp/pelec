import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyAppBridgeApi } from '../../legacyBridge';
import { installDom } from '../../test/dom';
import { TelegramComposer } from './TelegramComposer';

describe('TelegramComposer', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders into the target portal and routes draft and send actions', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      clearTelegramReply: vi.fn(),
      focusTelegramComposer: vi.fn(),
      removeTelegramAttachment: vi.fn(),
      sendTelegramMessage: vi.fn(),
      setTelegramDraftValue: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        attachments={[]}
        draftText="hi"
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const sendButton = target.querySelector('.telegram-send-button');
    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    fireEvent.click(sendButton as Element);

    expect(legacyApi.sendTelegramMessage).toHaveBeenCalled();
    expect(textarea?.value).toBe('');
  });

  it('renders the visible react composer textarea without redirecting focus to legacy input', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      clearTelegramReply: vi.fn(),
      focusTelegramComposer: vi.fn(),
      removeTelegramAttachment: vi.fn(),
      sendTelegramMessage: vi.fn(),
      setTelegramDraftValue: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        attachments={[]}
        draftText=""
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    expect(textarea?.id).toBe('telegram-compose-input');
    expect(legacyApi.focusTelegramComposer).not.toHaveBeenCalled();
  });

  it('grows the visible textarea when the draft becomes multiline', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      clearTelegramReply: vi.fn(),
      focusTelegramComposer: vi.fn(),
      removeTelegramAttachment: vi.fn(),
      sendTelegramMessage: vi.fn(),
      setTelegramDraftValue: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    const view = render(
      <TelegramComposer
        attachments={[]}
        draftText=""
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    expect(textarea).toBeTruthy();
    const scrollHeightGetter = vi
      .spyOn(window.HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(72);

    view.rerender(
      <TelegramComposer
        attachments={[]}
        draftText={'line one\nline two'}
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).style.height).toBe('72px');
    });
    scrollHeightGetter.mockRestore();
  });
});
