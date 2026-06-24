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
    vi.restoreAllMocks();
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
        editing={{ messageId: null, originalText: '' }}
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

  it('renders edit state and routes cancel edit', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      appendTelegramFiles: vi.fn(),
      cancelTelegramEdit: vi.fn(),
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
        draftText="edited text"
        editing={{ messageId: 'message-1', originalText: 'original text' }}
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    expect(view.getByText('Editing message')).toBeTruthy();
    expect(view.getByText('original text')).toBeTruthy();

    fireEvent.click(view.getByLabelText('Cancel edit'));

    expect(legacyApi.cancelTelegramEdit).toHaveBeenCalled();
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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

  it('warns and blocks text messages above Telegram character limits', () => {
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
    const longMessage = 'a'.repeat(4097);

    render(
      <TelegramComposer
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText={longMessage}
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    expect(target.querySelector('.telegram-compose-limit-warning')?.textContent).toContain(
      '4,097 / 4,096',
    );

    fireEvent.click(target.querySelector('.telegram-send-button') as Element);

    expect(legacyApi.sendTelegramMessage).not.toHaveBeenCalled();
    expect(target.querySelector('.telegram-limit-dialog')?.textContent).toContain(
      'above the 4,096 character limit',
    );
    expect(target.querySelector<HTMLTextAreaElement>('#telegram-compose-input')?.value).toBe(longMessage);

    fireEvent.click(target.querySelector('.telegram-limit-dialog-button') as Element);
    expect(target.querySelector('.telegram-limit-dialog')).toBeNull();
  });

  it('uses Telegram media caption limits when non-voice attachments are present', () => {
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
        editing={{ messageId: null, originalText: '' }}
        draftText={'a'.repeat(1025)}
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );

    expect(target.querySelector('.telegram-compose-limit-warning')?.textContent).toContain(
      '1,025 / 1,024',
    );

    fireEvent.click(target.querySelector('.telegram-send-button') as Element);

    expect(legacyApi.sendTelegramMessage).not.toHaveBeenCalled();
    expect(target.querySelector('.telegram-limit-dialog')?.textContent).toContain('Telegram caption');
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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

  it('suggests and inserts double-colon text expansions before sending', async () => {
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
        editing={{ messageId: null, originalText: '' }}
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
    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 7, selectionStart: 7, value: '::today' },
    });

    await waitFor(() => {
      expect(target.textContent).toContain('::today');
      expect(target.textContent).toContain('Current date');
    });

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea?.value).toMatch(/^\w{3} \d{2}, \d{4}$|^\d{2} \w{3} \d{4}$/u);
    });
    expect(legacyApi.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('expands direct double-colon random commands with Space', async () => {
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
        editing={{ messageId: null, originalText: '' }}
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
    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 17, selectionStart: 17, value: '::random(int, 4)' },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(17, 17);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: ' ' });

    await waitFor(() => {
      expect(textarea?.value).toMatch(/^\d{4} $/u);
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4} $/u));
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
        editing={{ messageId: null, originalText: '' }}
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
        editing={{ messageId: null, originalText: '' }}
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

  it('supports normal-mode cursor movement and character deletion in the composer', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="hello world"
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
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Escape' });

    await waitFor(() => {
      expect(textarea?.dataset.vimMode).toBe('normal');
    });
    expect(legacyApi.setMode).toHaveBeenLastCalledWith('normal');
    expect(textarea?.selectionStart).toBe(4);

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'h' });
    expect(textarea?.selectionStart).toBe(3);

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'x' });

    await waitFor(() => {
      expect(textarea?.value).toBe('helo world');
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('helo world');

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'i' });

    await waitFor(() => {
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
    expect(legacyApi.setMode).toHaveBeenLastCalledWith('insert');
  });

  it('prevents printable text input while the composer is in normal mode', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="hello"
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
    (textarea as HTMLTextAreaElement).setSelectionRange(2, 2);

    expect(fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'z' })).toBe(false);
    expect(textarea?.value).toBe('hello');
    expect(legacyApi.setTelegramDraftValue).not.toHaveBeenCalled();
  });

  it('uses standard text editing and hides modal UI when Vim mode is disabled', () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="hello"
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        vimModeEnabled={false}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    expect(textarea?.dataset.vimMode).toBe('insert');
    expect(target.querySelector('.telegram-vim-mode-indicator')).toBeNull();
    expect(target.querySelector('.telegram-compose-row')?.classList.contains('vim-disabled')).toBe(
      true,
    );
    expect(fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'z' })).toBe(true);
    expect(fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Escape' })).toBe(true);
    expect(legacyApi.setMode).not.toHaveBeenCalled();
  });

  it('ignores Vim count prefixes when counts are disabled', () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="one two three"
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        vimCountsEnabled={false}
        voiceRecorderState="idle"
      />,
    );

    const textarea = target.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
    fireEvent.focus(textarea as HTMLTextAreaElement);
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 0);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: '2' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });

    expect(textarea?.selectionStart).toBe(4);
  });

  it('supports normal-mode line deletion and ctrl-enter send', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText={'one\ntwo\nthree'}
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
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });

    await waitFor(() => {
      expect(textarea?.value).toBe('one\nthree');
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('one\nthree');

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { ctrlKey: true, key: 'Enter' });
    expect(legacyApi.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('supports inner-word and around-word delete/change operators', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    const view = render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="hello world again"
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
    (textarea as HTMLTextAreaElement).setSelectionRange(6, 6);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'i' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hello  again');
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('hello  again');

    view.rerender(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="hello world again"
        legacyApi={legacyApi}
        replyPreview={null}
        sendBehavior="enter"
        target={target}
        voiceRecorderState="idle"
      />,
    );
    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 6, selectionStart: 6, value: 'hello world again' },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(6, 6);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'a' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hello again');
    });
    expect(legacyApi.setTelegramDraftValue).toHaveBeenLastCalledWith('hello again');

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 6, selectionStart: 6, value: 'hello world again' },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(6, 6);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'c' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'i' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hello  again');
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
    expect(legacyApi.setMode).toHaveBeenLastCalledWith('insert');

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'Escape' });
    await waitFor(() => {
      expect(textarea?.dataset.vimMode).toBe('normal');
    });
    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: { selectionEnd: 6, selectionStart: 6, value: 'hello world again' },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(6, 6);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'c' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'a' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hello again');
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
  });

  it('supports visual mode selection, delete, and change', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="hello world"
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
    (textarea as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'v' });

    await waitFor(() => {
      expect(textarea?.dataset.vimMode).toBe('visual');
    });
    expect(textarea?.selectionStart).toBe(1);
    expect(textarea?.selectionEnd).toBe(2);

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'l' });
    expect(textarea?.selectionStart).toBe(1);
    expect(textarea?.selectionEnd).toBe(3);

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'x' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hlo world');
      expect(textarea?.dataset.vimMode).toBe('normal');
    });

    (textarea as HTMLTextAreaElement).setSelectionRange(4, 4);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'v' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'e' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'c' });

    await waitFor(() => {
      expect(textarea?.value).toBe('hlo ');
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
  });

  it('supports visual block mode delete and change across lines', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText={'abcde\nabcde\nabcde'}
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
    (textarea as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { ctrlKey: true, key: 'v' });

    await waitFor(() => {
      expect(textarea?.dataset.vimMode).toBe('visual-block');
    });

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'j' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'l' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });

    await waitFor(() => {
      expect(textarea?.value).toBe('ade\nade\nabcde');
      expect(textarea?.dataset.vimMode).toBe('normal');
    });

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: {
        selectionEnd: 1,
        selectionStart: 1,
        value: 'abcde\nabcde\nabcde',
      },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { ctrlKey: true, key: 'v' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'j' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'l' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'c' });

    await waitFor(() => {
      expect(textarea?.value).toBe('ade\nade\nabcde');
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
  });

  it('supports visual line mode selection, delete, and change', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText={'one\ntwo\nthree'}
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
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'V', shiftKey: true });

    await waitFor(() => {
      expect(textarea?.dataset.vimMode).toBe('visual-line');
    });
    expect(textarea?.selectionStart).toBe(4);
    expect(textarea?.selectionEnd).toBe(8);

    expect(fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'z' })).toBe(false);
    expect(textarea?.value).toBe('one\ntwo\nthree');

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'j' });
    expect(textarea?.selectionStart).toBe(4);
    expect(textarea?.selectionEnd).toBe(13);

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });

    await waitFor(() => {
      expect(textarea?.value).toBe('one\n');
      expect(textarea?.dataset.vimMode).toBe('normal');
    });

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: {
        selectionEnd: 5,
        selectionStart: 5,
        value: 'one\ntwo\nthree',
      },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'V', shiftKey: true });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'c' });

    await waitFor(() => {
      expect(textarea?.value).toBe('one\nthree');
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
  });

  it('moves and deletes whole grapheme clusters in normal and visual modes', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="a👨‍👩‍👧‍👦b"
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
    (textarea as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'l' });
    expect(textarea?.selectionStart).toBe('a👨‍👩‍👧‍👦'.length);

    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'h' });
    expect(textarea?.selectionStart).toBe(1);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'x' });

    await waitFor(() => {
      expect(textarea?.value).toBe('ab');
    });

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: {
        selectionEnd: 1,
        selectionStart: 1,
        value: 'a👨‍👩‍👧‍👦b',
      },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'v' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });

    await waitFor(() => {
      expect(textarea?.value).toBe('ab');
      expect(textarea?.dataset.vimMode).toBe('normal');
    });
  });

  it('supports count prefixes and common delete/change motions', async () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText="one two three four"
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
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 0);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: '2' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });
    expect(textarea?.selectionStart).toBe(8);

    (textarea as HTMLTextAreaElement).setSelectionRange(0, 0);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'w' });

    await waitFor(() => {
      expect(textarea?.value).toBe('two three four');
    });

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: {
        selectionEnd: 4,
        selectionStart: 4,
        value: 'one\ntwo\nthree\nfour',
      },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(4, 4);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: '2' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'd' });

    await waitFor(() => {
      expect(textarea?.value).toBe('one\nfour');
    });

    fireEvent.input(textarea as HTMLTextAreaElement, {
      target: {
        selectionEnd: 4,
        selectionStart: 4,
        value: 'one two',
      },
    });
    (textarea as HTMLTextAreaElement).setSelectionRange(4, 4);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'c' });
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: '$' });

    await waitFor(() => {
      expect(textarea?.value).toBe('one ');
      expect(textarea?.dataset.vimMode).toBe('insert');
    });
  });

  it('preserves the preferred column across short lines during vertical movement', () => {
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
      setMode: vi.fn(),
      startTelegramVoiceRecording: vi.fn(),
      stopTelegramVoiceRecording: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramComposer
        appMode="normal"
        attachments={[]}
        canSend
        editing={{ messageId: null, originalText: '' }}
        draftText={'abcdef\nx\nabcdef'}
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
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'j' });
    expect(textarea?.selectionStart).toBe(8);
    fireEvent.keyDown(textarea as HTMLTextAreaElement, { key: 'j' });
    expect(textarea?.selectionStart).toBe(14);
  });
});
