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

  it('does not replace focused typing with a stale draft prop', async () => {
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

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { value: 'abcd' },
    });

    view.rerender(
      <TelegramComposer
        attachments={[]}
        canSend
        draftText="abc"
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    await waitFor(() => {
      expect(textarea?.value).toBe('abcd');
    });
  });

  it('keeps an empty startup textarea compact even when scrollHeight is large', async () => {
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
        draftText="temporary"
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    expect(textarea).toBeTruthy();
    Object.defineProperty(textarea as HTMLTextAreaElement, 'scrollHeight', {
      configurable: true,
      value: 160,
    });

    view.rerender(
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

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).style.height).toBe('48px');
      expect((textarea as HTMLTextAreaElement).style.overflowY).toBe('hidden');
    });
  });

  it('expands the visible textarea to fit multiline drafts', async () => {
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
    Object.defineProperty(textarea as HTMLTextAreaElement, 'scrollHeight', {
      configurable: true,
      value: 86,
    });

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
      expect((textarea as HTMLTextAreaElement).style.height).toBe('86px');
      expect((textarea as HTMLTextAreaElement).style.overflowY).toBe('hidden');
    });
  });

  it('caps oversized drafts and enables textarea scrolling', async () => {
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
        draftText={'line one\nline two\nline three'}
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    Object.defineProperty(textarea as HTMLTextAreaElement, 'scrollHeight', {
      configurable: true,
      value: 240,
    });

    view.rerender(
      <TelegramComposer
        attachments={[]}
        canSend
        draftText={'line one\nline two\nline three\nline four\nline five\nline six'}
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    await waitFor(() => {
      expect(textarea?.style.height).toBe('160px');
      expect(textarea?.style.overflowY).toBe('auto');
    });
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

  it('accepts pasted image files from the composer textarea', () => {
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
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });

    fireEvent.paste(textarea as HTMLTextAreaElement, {
      clipboardData: {
        files: [file],
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(legacyApi.appendTelegramFiles).toHaveBeenCalledWith([file]);
  });

  it('keeps normal text paste behavior when no files are present', () => {
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

    fireEvent.paste(textarea as HTMLTextAreaElement, {
      clipboardData: {
        files: [],
        items: [
          {
            kind: 'string',
            getAsFile: (): File | null => null,
          },
        ],
      },
    });

    expect(legacyApi.appendTelegramFiles).not.toHaveBeenCalled();
  });

  it('lets image attachments switch between image and file sends', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      cancelTelegramVoiceRecording: vi.fn(),
      clearTelegramReply: vi.fn(),
      focusTelegramComposer: vi.fn(),
      removeTelegramAttachment: vi.fn(),
      sendTelegramMessage: vi.fn(),
      setTelegramAttachmentSendAs: vi.fn(),
      setTelegramDraftValue: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        attachments={[
          {
            id: 'image-1',
            kind: 'image',
            name: 'photo.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aW1hZ2U=',
            sendAs: 'image',
          },
        ]}
        canSend
        draftText=""
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const fileButton = target.querySelector<HTMLButtonElement>(
      '.telegram-compose-image-mode button:nth-child(2)',
    );
    expect(fileButton?.textContent).toBe('File');

    fireEvent.click(fileButton as HTMLButtonElement);
    expect(legacyApi.setTelegramAttachmentSendAs).toHaveBeenCalledWith('image-1', 'document');
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

  it('suggests and inserts mention completions from the current chat', async () => {
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
        mentionSuggestions={[
          { displayName: 'Ada Lovelace', mention: '@ada', username: 'ada' },
          { displayName: 'Grace Hopper', mention: '@grace', username: 'grace' },
        ]}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    expect(textarea).toBeTruthy();

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 7, selectionStart: 7, value: 'hey @ad' },
    });

    await waitFor(() => {
      expect(target.textContent).toContain('Ada Lovelace');
      expect(target.textContent).not.toContain('Grace Hopper');
    });

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hey @ada');
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('hey @ada');
    expect(legacyApi.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('cycles mention completions with arrows before inserting', async () => {
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
        mentionSuggestions={[
          { displayName: 'Ada Lovelace', mention: '@ada', username: 'ada' },
          { displayName: 'Grace Hopper', mention: '@grace', username: 'grace' },
        ]}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 1, selectionStart: 1, value: '@' },
    });

    await waitFor(() => {
      expect(target.textContent).toContain('Ada Lovelace');
      expect(target.textContent).toContain('Grace Hopper');
    });

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Tab' });

    await waitFor(() => {
      expect(textarea?.value).toBe('@grace');
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('@grace');
  });
});
