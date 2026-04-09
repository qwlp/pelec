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
      cancelTelegramVoiceRecording: vi.fn(),
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
        canSend
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
      cancelTelegramVoiceRecording: vi.fn(),
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
        canSend
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
      cancelTelegramVoiceRecording: vi.fn(),
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
        canSend
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
        canSend
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

  it('does not render when sending is disabled for the active chat', () => {
    const target = document.createElement('div');
    document.body.append(target);

    render(
      <TelegramComposer
        attachments={[]}
        canSend={false}
        draftText=""
        legacyApi={null}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    expect(target.querySelector('#telegram-compose-input')).toBeNull();
  });

  it('starts recording on click and shows explicit stop and cancel controls while recording', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      cancelTelegramVoiceRecording: vi.fn(),
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
        canSend
        draftText=""
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    fireEvent.click(target.querySelector('.telegram-voice-record-button') as Element);
    expect(legacyApi.startTelegramVoiceRecording).toHaveBeenCalled();

    view.rerender(
      <TelegramComposer
        attachments={[]}
        canSend
        draftText=""
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="recording"
      />,
    );

    expect(target.textContent).toContain('Recording');
    expect(target.querySelector('.telegram-voice-recorder-cancel')).toBeTruthy();

    fireEvent.click(target.querySelector('.telegram-voice-record-button') as Element);
    expect(legacyApi.stopTelegramVoiceRecording).toHaveBeenCalled();

    fireEvent.click(target.querySelector('.telegram-voice-recorder-cancel') as Element);
    expect(legacyApi.cancelTelegramVoiceRecording).toHaveBeenCalled();
  });

  it('accepts dropped files from the composer shell', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      cancelTelegramVoiceRecording: vi.fn(),
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
        canSend
        draftText=""
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const shell = target.querySelector('.telegram-composer-react-shell') as Element;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const dragData = {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file' }],
        dropEffect: 'none',
      },
    };

    fireEvent.dragEnter(shell, dragData);
    expect(target.querySelector('.telegram-drop-target')).toBeTruthy();

    fireEvent.drop(shell, dragData);
    expect(legacyApi.appendTelegramFiles).toHaveBeenCalledWith([file]);
  });

  it('completes the active emoji suggestion before sending on Enter', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      cancelTelegramVoiceRecording: vi.fn(),
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
        canSend
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

    fireEvent.focus(textarea as HTMLTextAreaElement);
    fireEvent.change(textarea as HTMLTextAreaElement, {
      target: { value: ':sob:' },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.select(textarea as HTMLTextAreaElement);

    await waitFor(() => {
      expect(target.textContent).toContain(':sob:');
    });

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea?.value).toBe('😭');
    });
    expect(legacyApi.sendTelegramMessage).not.toHaveBeenCalled();
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('😭');

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Enter' });

    expect(legacyApi.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});
