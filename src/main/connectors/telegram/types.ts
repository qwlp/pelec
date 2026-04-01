export type TdClient = {
  invoke: (request: Record<string, unknown>) => Promise<unknown>;
  on: (event: 'update' | 'error' | 'close', handler: (payload: unknown) => void) => void;
  close?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
};

export type AuthorizationState = {
  _: string;
  link?: string;
};

export type AuthorizationUpdate = {
  _: string;
  authorization_state?: AuthorizationState;
};

export type TdUpdateWithChatContext = AuthorizationUpdate & {
  chat_id?: number;
  message?: { chat_id?: number };
};

export type TdMessage = {
  id?: number | string | bigint;
  media_album_id?: string;
  date?: number;
  is_outgoing?: boolean;
  forward_info?: {
    origin?: {
      _?: string;
      sender_user_id?: number;
      sender_name?: string;
      sender_chat_id?: number;
      chat_id?: number;
      author_signature?: string;
    };
  };
  reply_to?: {
    message_id?: number | string | bigint;
  };
  reply_to_message_id?: number | string | bigint;
  sender_id?: { user_id?: number; chat_id?: number; _: string };
  interaction_info?: unknown;
  content?: unknown;
};

export type TdChat = {
  id?: number;
  title?: string;
  type?: { _: string };
  unread_count?: number;
  last_message?: {
    content?: unknown;
    is_outgoing?: boolean;
    date?: number;
  };
  last_read_outbox_message_id?: number | string | bigint;
  notification_settings?: {
    use_default_mute_for?: boolean;
    mute_for?: number;
  };
};

export type TdScopeNotificationSettings = {
  mute_for?: number;
};

export type TdFileRef = {
  id?: number;
  size?: number;
  expected_size?: number;
  local?: {
    path?: string;
    is_downloading_active?: boolean;
    is_downloading_completed?: boolean;
    downloaded_prefix_size?: number;
  };
};

export type TelegramDocumentRef = {
  file: TdFileRef | undefined;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ParsedDataUrl = {
  fullMimeType: string;
  essenceMimeType: string;
  bytes: Buffer;
};

export type PreparedUploadFile = {
  tempDir: string;
  filePath: string;
  mimeType: string;
};

export type PreparedVoiceNoteUpload = {
  tempDir: string;
  sourceFilePath: string;
  outputFilePath: string;
  outputMimeType: 'audio/ogg;codecs=opus';
  durationSeconds: number;
};
