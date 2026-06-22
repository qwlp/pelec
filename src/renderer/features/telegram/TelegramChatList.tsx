import { useEffect, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react';
import type { ChatSummary, ConnectorProfile } from '../../../shared/connectors';
import { formatChatTimestamp, formatFullDateTime, hasValidTimestamp } from '../../lib/format';

interface TelegramChatListProps {
  activeChatId: string | null;
  chats: ChatSummary[];
  configPath?: string | null;
  listRef?: RefObject<HTMLElement | null>;
  loadError: string | null;
  loading: boolean;
  onClearCache?(): void | Promise<void>;
  onClearSearch?(): void;
  onLogin?(): void | Promise<void>;
  onLogout?(): void | Promise<void>;
  onOpenConfig?(): void | Promise<void>;
  onRefresh?(): void | Promise<void>;
  onSearchQueryChange(query: string): void;
  onSelectChat(chatId: string): void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedChatId: string | null;
}

const buildInitials = (label: string): string => {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length < 1) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const formatUnreadBadge = (count: number): string => {
  if (count > 99) {
    return '99+';
  }
  return String(Math.max(0, Math.floor(count)));
};

const formatCacheSizeLabel = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return 'Cache size unavailable';
  }

  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) {
    return `Cache ${(megabytes / 1024).toFixed(2)} GB`;
  }
  return `Cache ${megabytes.toFixed(1)} MB`;
};

const renderAvatar = (chat: ChatSummary) => {
  const title = chat.title.trim() || 'Untitled chat';
  if (chat.avatarUrl) {
    return (
      <div className="telegram-avatar">
        <img src={chat.avatarUrl} alt={`${title} avatar`} loading="lazy" />
      </div>
    );
  }

  return <div className="telegram-avatar fallback">{buildInitials(title)}</div>;
};

const renderProfileAvatar = (
  profile: Pick<ConnectorProfile, 'avatarUrl' | 'displayName'> | null,
  className: string,
) => {
  const label = profile?.displayName?.trim() || 'Telegram profile';
  if (profile?.avatarUrl) {
    return (
      <div className={className}>
        <img src={profile.avatarUrl} alt={`${label} avatar`} loading="lazy" />
      </div>
    );
  }

  return <div className={`${className} fallback`}>{buildInitials(label)}</div>;
};

const readFileAsDataUrl = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
        return;
      }
      reject(new Error('Failed to read image file.'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image file.'));
    };
    reader.readAsDataURL(file);
  });

const convertImageDataUrlToJpeg = async (dataUrl: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas 2D context is unavailable.'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    image.onerror = () => {
      reject(new Error('Failed to decode the selected image.'));
    };
    image.src = dataUrl;
  });

const TelegramChatSettingsMenu = ({
  configPath,
  onClearCache,
  onClearSearch,
  onOpenConfig,
  onRefresh,
  searchQuery,
}: {
  configPath?: string | null;
  onClearCache?(): void | Promise<void>;
  onClearSearch?(): void;
  onOpenConfig?(): void | Promise<void>;
  onRefresh?(): void | Promise<void>;
  searchQuery: string;
}) => {
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    void window.pelec
      .getAppCacheSize()
      .then((size) => {
        if (!cancelled) {
          setCacheSizeBytes(size);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCacheSizeBytes(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const runAction = async (actionId: string, action?: (() => void | Promise<void>) | null) => {
    if (!action || busyAction) {
      return;
    }
    setBusyAction(actionId);
    try {
      await action();
      if (actionId === 'clear-cache') {
        try {
          setCacheSizeBytes(await window.pelec.getAppCacheSize());
        } catch {
          setCacheSizeBytes(null);
        }
      }
      setOpen(false);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div ref={containerRef} className={`telegram-settings-shell${open ? ' open' : ''}`}>
      <button
        type="button"
        className="telegram-settings-toggle"
        aria-label="Open Telegram settings"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ≡
      </button>
      {open ? (
        <div className="telegram-settings-panel" role="menu" aria-label="Telegram settings">
          <div className="telegram-settings-title">Settings</div>
          <div className="telegram-settings-meta">{formatCacheSizeLabel(cacheSizeBytes)}</div>
          <button
            type="button"
            className="telegram-settings-item"
            disabled={!!busyAction}
            onClick={() => void runAction('clear-cache', onClearCache)}
          >
            Clear Cache
          </button>
          <button
            type="button"
            className="telegram-settings-item"
            disabled={!!busyAction || !searchQuery.trim()}
            onClick={() => {
              onClearSearch?.();
              setOpen(false);
            }}
          >
            Clear Search
          </button>
          <button
            type="button"
            className="telegram-settings-item"
            disabled={!!busyAction}
            onClick={() => void runAction('refresh', onRefresh)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="telegram-settings-item"
            disabled={!!busyAction || !configPath || !onOpenConfig}
            onClick={() => void runAction('open-config', onOpenConfig)}
          >
            Open Config
          </button>
          {configPath ? <div className="telegram-settings-path">{configPath}</div> : null}
        </div>
      ) : null}
    </div>
  );
};

const TelegramProfileMenu = ({
  onLogin,
  onLogout,
}: {
  onLogin?(): void | Promise<void>;
  onLogout?(): void | Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [profile, setProfile] = useState<ConnectorProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [pendingAvatarDataUrl, setPendingAvatarDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const firstNameInputRef = useRef<HTMLInputElement | null>(null);
  const lastNameInputRef = useRef<HTMLInputElement | null>(null);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);

  const applyProfile = (nextProfile: ConnectorProfile | null) => {
    setProfile(nextProfile);
    setFirstName(nextProfile?.firstName ?? '');
    setLastName(nextProfile?.lastName ?? '');
    setUsername(nextProfile?.username ?? '');
    setPendingAvatarDataUrl(null);
  };

  const loadProfile = async () => {
    setLoadError(null);
    try {
      const nextProfile = await window.pelec.getConnectorProfile('telegram');
      applyProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Telegram profile.';
      setLoadError(message);
      setProfile(null);
      return null;
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    if (!profile) {
      void loadProfile();
    }
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, profile]);

  const runAction = async (actionId: string, action?: (() => void | Promise<void>) | null) => {
    if (!action || busyAction) {
      return;
    }
    setNotice(null);
    setBusyAction(actionId);
    try {
      await action();
      if (actionId === 'login') {
        setNotice('Login flow started.');
      }
      if (actionId === 'logout') {
        applyProfile(null);
        setNotice('Logged out.');
      }
      setOpen(false);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAvatarPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setNotice(null);
    setLoadError(null);

    if (!file.type.startsWith('image/')) {
      setLoadError('Choose an image file for the Telegram profile photo.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const jpegDataUrl = file.type === 'image/jpeg' ? dataUrl : await convertImageDataUrlToJpeg(dataUrl);
      setPendingAvatarDataUrl(jpegDataUrl);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to prepare the selected image.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveProfile = async () => {
    if (busyAction) {
      return;
    }

    const normalizedFirstName = (firstNameInputRef.current?.value ?? firstName).trim();
    if (!normalizedFirstName) {
      setLoadError('First name is required.');
      return;
    }

    const normalizedLastName = (lastNameInputRef.current?.value ?? lastName).trim();
    const normalizedUsername = (usernameInputRef.current?.value ?? username)
      .trim()
      .replace(/^@+/u, '');

    setBusyAction('save-profile');
    setLoadError(null);
    setNotice(null);
    try {
      const nextProfile = await window.pelec.updateConnectorProfile('telegram', {
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        username: normalizedUsername,
        avatarDataUrl: pendingAvatarDataUrl ?? undefined,
        avatarFileName: pendingAvatarDataUrl ? 'profile-photo.jpg' : undefined,
      });

      if (!nextProfile) {
        setLoadError('Telegram profile update did not return account data.');
        return;
      }

      applyProfile(nextProfile);
      setNotice('Profile updated.');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to update Telegram profile.');
    } finally {
      setBusyAction(null);
    }
  };

  const buttonProfile =
    pendingAvatarDataUrl !== null
      ? {
          displayName: profile?.displayName || firstName || 'Telegram profile',
          avatarUrl: pendingAvatarDataUrl,
        }
      : profile;

  return (
    <div ref={containerRef} className={`telegram-profile-shell${open ? ' open' : ''}`}>
      <button
        type="button"
        className="telegram-profile-toggle"
        aria-label="Open Telegram profile"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {renderProfileAvatar(buttonProfile, 'telegram-profile-toggle-avatar')}
      </button>
      {open ? (
        <div className="telegram-profile-panel" role="dialog" aria-label="Telegram profile">
          <div className="telegram-profile-panel-header">
            {renderProfileAvatar(buttonProfile, 'telegram-profile-avatar')}
            <div className="telegram-profile-summary">
              <div className="telegram-profile-title">{profile?.displayName || 'Telegram account'}</div>
              <div className="telegram-profile-handle">
                {profile?.username ? `@${profile.username}` : 'Not signed in or no username set'}
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="telegram-profile-file-input"
            onChange={(event) => void handleAvatarPick(event)}
          />
          <button
            type="button"
            className="telegram-profile-photo-button"
            disabled={!!busyAction}
            onClick={() => fileInputRef.current?.click()}
          >
            Change Photo
          </button>
          {profile ? (
            <>
              <label className="telegram-profile-field">
                <span className="telegram-profile-field-label">First Name</span>
                <input
                  ref={firstNameInputRef}
                  aria-label="First Name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  disabled={!!busyAction}
                />
              </label>
              <label className="telegram-profile-field">
                <span className="telegram-profile-field-label">Last Name</span>
                <input
                  ref={lastNameInputRef}
                  aria-label="Last Name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  disabled={!!busyAction}
                />
              </label>
              <label className="telegram-profile-field">
                <span className="telegram-profile-field-label">Username</span>
                <input
                  ref={usernameInputRef}
                  aria-label="Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={!!busyAction}
                  placeholder="@username"
                />
              </label>
              <button
                type="button"
                className="telegram-profile-action telegram-profile-save"
                disabled={!!busyAction}
                onClick={() => void handleSaveProfile()}
              >
                Save Profile
              </button>
            </>
          ) : (
            <div className="telegram-profile-empty">Telegram account isn&apos;t signed in.</div>
          )}
          {loadError ? <div className="telegram-profile-status error">{loadError}</div> : null}
          {notice ? <div className="telegram-profile-status">{notice}</div> : null}
          <div className="telegram-profile-actions">
            <button
              type="button"
              className="telegram-profile-action"
              disabled={!!busyAction}
              onClick={() => void runAction('login', onLogin)}
            >
              Log In
            </button>
            <button
              type="button"
              className="telegram-profile-action"
              disabled={!!busyAction || !onLogout || !profile}
              onClick={() => void runAction('logout', onLogout)}
            >
              Log Out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const TelegramChatList = ({
  activeChatId,
  chats,
  configPath,
  listRef,
  loadError,
  loading,
  onClearCache,
  onClearSearch,
  onLogin,
  onLogout,
  onOpenConfig,
  onRefresh,
  onSearchQueryChange,
  onSelectChat,
  searchInputRef,
  searchQuery,
  selectedChatId,
}: TelegramChatListProps) => {
  const internalListRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!listRef) {
      return;
    }
    listRef.current = internalListRef.current;
  }, [listRef]);

  useEffect(() => {
    const list = internalListRef.current;
    if (!list) {
      return;
    }

    const selected =
      (selectedChatId
        ? list.querySelector<HTMLElement>('.telegram-chat-item.selected')
        : null) ??
      (activeChatId ? list.querySelector<HTMLElement>('.telegram-chat-item.active') : null);

    selected?.scrollIntoView?.({ block: 'nearest' });
  }, [activeChatId, chats.length, searchQuery, selectedChatId]);

  let content: ReactNode;
  if (loading && chats.length < 1) {
    content = <div className="telegram-empty">Loading chats...</div>;
  } else if (loadError) {
    content = <div className="telegram-empty">{loadError}</div>;
  } else if (chats.length < 1) {
    content = (
      <div className="telegram-empty">
        {searchQuery.trim() ? 'No chats match your search.' : 'No chats yet.'}
      </div>
    );
  } else {
    content = (
      <>
        {chats.map((chat) => {
          const unreadCount = Math.max(0, Math.floor(chat.unreadCount));
          const title = chat.title.trim() || 'Untitled chat';
          const preview = chat.lastMessagePreview.trim() || 'No preview';
          const previewSender = chat.lastMessageSender?.trim() ?? '';
          const timestampLabel = formatChatTimestamp(chat.lastMessageTimestamp);
          const timestampTitle = hasValidTimestamp(chat.lastMessageTimestamp)
            ? formatFullDateTime(chat.lastMessageTimestamp)
            : undefined;
          const isActive = activeChatId === chat.id;
          const isSelected = selectedChatId === chat.id;

          return (
            <button
              key={chat.id}
              type="button"
              className={`telegram-chat-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}${
                unreadCount > 0 ? ' unread' : ' read'
              }${chat.isMuted ? ' muted' : ''}`}
              onClick={() => onSelectChat(chat.id)}
            >
              {renderAvatar(chat)}
              <div className="telegram-chat-content">
                <div className="telegram-chat-top">
                  <div className="telegram-chat-name">{title}</div>
                  <div className="telegram-chat-date" title={timestampTitle}>
                    {timestampLabel}
                  </div>
                </div>
                <div className="telegram-chat-bottom">
                  <div className="telegram-chat-preview">
                    {previewSender ? (
                      <span className="telegram-chat-preview-sender">{previewSender}: </span>
                    ) : null}
                    <span className="telegram-chat-preview-text">{preview}</span>
                  </div>
                  <div className="telegram-chat-status">
                    {unreadCount > 0 ? (
                      <span className="telegram-chat-unread-badge">{formatUnreadBadge(unreadCount)}</span>
                    ) : chat.lastMessageOutgoing ? (
                      <span
                        className={`telegram-chat-receipt ${chat.lastMessageReadByPeer ? 'read' : 'sent'}`}
                        title={chat.lastMessageReadByPeer ? 'Read' : 'Sent'}
                      >
                        <span
                          className={`telegram-chat-tick${chat.lastMessageReadByPeer ? ' double' : ''}`}
                          aria-label={chat.lastMessageReadByPeer ? 'Read' : 'Sent'}
                        >
                          {chat.lastMessageReadByPeer ? '✓✓' : '✓'}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </>
    );
  }

  return (
    <aside className="telegram-left-pane modern-telegram-chat-pane" aria-label="Telegram chats">
      <header className="telegram-left-header">
        <TelegramChatSettingsMenu
          configPath={configPath}
          onClearCache={onClearCache}
          onClearSearch={onClearSearch}
          onOpenConfig={onOpenConfig}
          onRefresh={onRefresh}
          searchQuery={searchQuery}
        />
        <input
          ref={searchInputRef}
          className="telegram-search"
          placeholder="Search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
        <TelegramProfileMenu onLogin={onLogin} onLogout={onLogout} />
      </header>
      <section ref={internalListRef} className="telegram-chat-list" tabIndex={-1}>
        {content}
      </section>
    </aside>
  );
};
