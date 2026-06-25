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
  call?: TdCall;
  call_id?: number;
  data?: string;
  group_call?: TdGroupCall;
  group_call_id?: number;
  participant?: TdGroupCallParticipant;
};

export type TdMessage = {
  id?: number | string | bigint;
  media_album_id?: string;
  date?: number;
  can_be_edited?: boolean;
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

export type TdChatPermissions = {
  can_send_basic_messages?: boolean;
};

export type TdChatMemberStatus = {
  _: string;
  is_member?: boolean;
  permissions?: TdChatPermissions;
  rights?: {
    can_post_messages?: boolean;
  };
};

export type TdChat = {
  id?: number;
  title?: string;
  type?: {
    _: string;
    user_id?: number;
    basic_group_id?: number;
    supergroup_id?: number;
    is_channel?: boolean;
  };
  permissions?: TdChatPermissions;
  unread_count?: number;
  last_message?: {
    id?: number | string | bigint;
    content?: unknown;
    is_outgoing?: boolean;
    date?: number;
    sender_id?: { user_id?: number; chat_id?: number; _: string };
  };
  last_read_outbox_message_id?: number | string | bigint;
  notification_settings?: {
    use_default_mute_for?: boolean;
    mute_for?: number;
  };
  video_chat?: {
    group_call_id?: number;
    has_participants?: boolean;
  };
};

export type TdCallProtocol = {
  _: 'callProtocol';
  udp_p2p?: boolean;
  udp_reflector?: boolean;
  min_layer?: number;
  max_layer?: number;
  library_versions?: string[];
};

export type TdCallState =
  | { _: 'callStatePending'; is_created?: boolean; is_received?: boolean }
  | { _: 'callStateExchangingKeys' }
  | {
      _: 'callStateReady';
      protocol?: TdCallProtocol;
      servers?: unknown[];
      config?: string;
      encryption_key?: string;
      emojis?: string[];
      allow_p2p?: boolean;
      custom_parameters?: string;
    }
  | { _: 'callStateHangingUp' }
  | {
      _: 'callStateDiscarded';
      reason?: { _?: string };
      need_rating?: boolean;
      need_debug_information?: boolean;
      need_log?: boolean;
    }
  | { _: 'callStateError'; error?: { code?: number; message?: string } };

export type TdCall = {
  id?: number;
  unique_id?: string;
  user_id?: number;
  is_outgoing?: boolean;
  is_video?: boolean;
  state?: TdCallState;
};

export type TdGroupCallParticipant = {
  participant_id?: { _?: string; user_id?: number; chat_id?: number };
  audio_source_id?: number;
  is_current_user?: boolean;
  is_speaking?: boolean;
  is_muted_for_all_users?: boolean;
  is_muted_for_current_user?: boolean;
  volume_level?: number;
  order?: string;
  video_info?: {
    endpoint_id?: string;
    is_paused?: boolean;
    source_groups?: Array<{ semantics?: string; source_ids?: number[] }>;
  };
  screen_sharing_video_info?: {
    endpoint_id?: string;
    is_paused?: boolean;
    source_groups?: Array<{ semantics?: string; source_ids?: number[] }>;
  };
};

export type TdGroupCall = {
  id?: number;
  title?: string;
  is_active?: boolean;
  is_joined?: boolean;
  need_rejoin?: boolean;
  can_be_managed?: boolean;
  participant_count?: number;
  loaded_all_participants?: boolean;
  is_my_video_enabled?: boolean;
  is_my_video_paused?: boolean;
  can_enable_video?: boolean;
};

export type TdBasicGroup = {
  id?: number;
  status?: TdChatMemberStatus;
};

export type TdSupergroup = {
  id?: number;
  status?: TdChatMemberStatus;
  is_channel?: boolean;
  is_broadcast_group?: boolean;
  is_direct_messages_group?: boolean;
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

export type TdSticker = {
  emoji?: string;
  width?: number;
  height?: number;
  sticker?: TdFileRef;
  thumbnail?: { file?: TdFileRef };
  format?: { _?: string };
  set_id?: number | string;
};

export type TdAnimation = {
  width?: number;
  height?: number;
  animation?: TdFileRef;
  thumbnail?: { file?: TdFileRef };
  mime_type?: string;
  file_name?: string;
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
