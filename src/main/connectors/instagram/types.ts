export interface InstagramPendingTwoFactor {
  username: string;
  twoFactorIdentifier: string;
  totpTwoFactorOn: boolean;
}

export interface InstagramPendingChallenge {
  username: string;
  stepName?: string;
  contactPoint?: string;
}

export interface InstagramMetaState {
  currentUsername?: string;
  pendingTwoFactor?: InstagramPendingTwoFactor;
  pendingChallenge?: InstagramPendingChallenge;
}

export interface InstagramAuthResult {
  ok: boolean;
  details: string;
  username?: string;
  requiresTwoFactor?: boolean;
  requiresChallenge?: boolean;
}

export interface InstagramInboxResponse {
  inbox?: {
    threads?: InstagramThread[];
  };
}

export interface InstagramThread {
  thread_id?: string;
  thread_v2_id?: string;
  last_activity_at?: string | number;
  thread_title?: string;
  users?: Array<{
    pk?: number | string;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    is_verified?: boolean;
  }>;
  items?: InstagramMessageItem[];
  last_permanent_item?: InstagramMessageItem;
  unread_count?: number;
  read_state?: number;
  viewer_id?: string | number;
  has_older?: boolean;
}

export interface InstagramThreadResponse {
  thread?: InstagramThread;
}

export interface InstagramMessageItem {
  item_id?: string;
  client_context?: string;
  user_id?: number | string;
  timestamp?: string | number;
  item_type?: string;
  text?: string;
  is_sent_by_viewer?: boolean;
  is_shh_mode?: boolean;
  seen_user_ids?: Array<number | string>;
  action_log?: {
    description?: string;
  };
  media?: {
    id?: string | number;
    media_type?: number;
    image_versions2?: {
      candidates?: Array<{ url?: string; width?: number; height?: number }>;
    };
    video_versions?: Array<{ url?: string; type?: number; width?: number; height?: number }>;
  };
  media_share?: {
    image_versions2?: {
      candidates?: Array<{ url?: string; width?: number; height?: number }>;
    };
    video_versions?: Array<{ url?: string; type?: number; width?: number; height?: number }>;
  };
  link?: {
    text?: string;
    link_context?: {
      link_url?: string;
    };
  };
  replied_to_message?: {
    item_id?: string;
    client_context?: string;
    user_id?: number | string;
    text?: string;
    item_type?: string;
  };
  reactions?: {
    likes_count?: number;
    likes?: Array<{ sender_id: number | string }>;
    emojis?: Array<{ emoji: string; sender_id: number | string }>;
  };
}

export interface InstagramCurrentUserResponse {
  user?: {
    pk?: number | string;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
  };
}

export interface InstagramBroadcastResponse {
  status?: string;
  payload?: {
    item_id?: string;
  };
  item_id?: string;
}

export type InstagramRealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type InstagramRuntimeEvent =
  | { kind: 'realtime-status'; status: InstagramRealtimeStatus }
  | { kind: 'message'; threadId: string }
  | { kind: 'reaction'; threadId: string }
  | { kind: 'seen'; threadId: string };
