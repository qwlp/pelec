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
  thread_title?: string;
  users?: Array<{
    pk?: number | string;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
  }>;
  items?: InstagramMessageItem[];
  last_permanent_item?: InstagramMessageItem;
  unread_count?: number;
  read_state?: number;
}

export interface InstagramThreadResponse {
  thread?: InstagramThread;
}

export interface InstagramMessageItem {
  item_id?: string;
  user_id?: number | string;
  timestamp?: string | number;
  item_type?: string;
  text?: string;
  media?: {
    image_versions2?: {
      candidates?: Array<{ url?: string }>;
    };
    video_versions?: Array<{ url?: string; type?: number }>;
  };
  link?: {
    text?: string;
    link_context?: {
      link_url?: string;
    };
  };
  replied_to_message?: {
    item_id?: string;
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
}
