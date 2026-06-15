import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TelegramConversationErrorBoundaryProps {
  activeChatId: string | null;
  activeChatTitle: string;
  children: ReactNode;
  messageIds: string[];
  onBackToChats?: () => void;
  target: HTMLElement | null;
}

interface TelegramConversationErrorBoundaryState {
  error: Error | null;
  incidentId: string | null;
}

const buildIncidentId = (): string =>
  `telegram-render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class TelegramConversationErrorBoundary extends Component<
  TelegramConversationErrorBoundaryProps,
  TelegramConversationErrorBoundaryState
> {
  state: TelegramConversationErrorBoundaryState = {
    error: null,
    incidentId: null,
  };

  static getDerivedStateFromError(error: Error): TelegramConversationErrorBoundaryState {
    return {
      error,
      incidentId: buildIncidentId(),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { activeChatId, activeChatTitle, messageIds } = this.props;
    console.error('[telegram][conversation-render] Failed to render conversation', {
      activeChatId,
      activeChatTitle,
      componentStack: info.componentStack,
      error,
      incidentId: this.state.incidentId,
      messageCount: messageIds.length,
      messageIds: messageIds.slice(-20),
      timestamp: new Date().toISOString(),
    });
  }

  componentDidUpdate(previousProps: TelegramConversationErrorBoundaryProps): void {
    if (
      this.state.error &&
      (previousProps.activeChatId !== this.props.activeChatId ||
        previousProps.messageIds !== this.props.messageIds)
    ) {
      this.setState({ error: null, incidentId: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null, incidentId: null });
  };

  render(): ReactNode {
    const { activeChatId, activeChatTitle, children, onBackToChats, target } = this.props;
    const { error, incidentId } = this.state;
    if (!error) {
      return children;
    }

    const fallback = (
      <div className="telegram-conversation-error" role="alert">
        <strong>This conversation could not be displayed.</strong>
        <span>
          {activeChatTitle || 'Telegram chat'} ({activeChatId || 'unknown chat ID'})
        </span>
        <code>{error.message || error.name || 'Unknown render error'}</code>
        <span>Incident: {incidentId}</span>
        <div className="telegram-conversation-error-actions">
          <button type="button" onClick={this.retry}>
            Try again
          </button>
          {onBackToChats ? (
            <button type="button" onClick={onBackToChats}>
              Back to chats
            </button>
          ) : null}
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    );

    return target ? createPortal(fallback, target) : fallback;
  }
}
