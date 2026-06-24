import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface TelegramContextMenuProps {
  canEdit: boolean;
  messageId: string;
  onClose(): void;
  onCopy(messageId: string): void;
  onDelete(messageId: string): void;
  onEdit(messageId: string): void;
  onForward(messageId: string): void;
  onReply(messageId: string): void;
  onSelect(messageId: string): void;
  x: number;
  y: number;
}

export const TelegramContextMenu = ({
  canEdit,
  messageId,
  onClose,
  onCopy,
  onDelete,
  onEdit,
  onForward,
  onReply,
  onSelect,
  x,
  y,
}: TelegramContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - rect.width - 12)),
      top: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - rect.height - 12)),
    });
  }, [x, y]);

  const actions = useMemo(
    () => [
      { id: 'copy', label: 'Copy', run: () => onCopy(messageId), visible: true },
      { id: 'select', label: 'Select', run: () => onSelect(messageId), visible: true },
      { id: 'edit', label: 'Edit', run: () => onEdit(messageId), visible: canEdit },
      { id: 'forward', label: 'Forward', run: () => onForward(messageId), visible: true },
      { id: 'reply', label: 'Reply', run: () => onReply(messageId), visible: true },
      { id: 'delete', label: 'Delete', run: () => onDelete(messageId), visible: true },
    ].filter((action) => action.visible),
    [canEdit, messageId, onCopy, onDelete, onEdit, onForward, onReply, onSelect],
  );

  return (
    <div className="telegram-context-menu-layer" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="telegram-context-menu"
        role="menu"
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="telegram-context-menu-item"
            role="menuitem"
            onClick={() => {
              action.run();
              onClose();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};
