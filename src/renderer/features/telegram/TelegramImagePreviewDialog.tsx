import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { formatFullDateTime, hasValidTimestamp } from '../../lib/format';
import type { LegacyTelegramImagePreviewMeta } from '../../legacyBridge';

interface TelegramImagePreviewDialogProps {
  imageUrl: string;
  meta?: LegacyTelegramImagePreviewMeta | null;
  onClose(): void;
  onCopy(): void;
  onDownload(): void;
}

export const TelegramImagePreviewDialog = ({
  imageUrl,
  meta,
  onClose,
  onCopy,
  onDownload,
}: TelegramImagePreviewDialogProps) => {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{
    offsetX: number;
    offsetY: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const sender = meta?.sender.trim();
  const timestamp = hasValidTimestamp(meta?.timestamp) ? formatFullDateTime(meta.timestamp) : '';
  const senderAvatarUrl = meta?.senderAvatarUrl?.trim();
  const imageName = useMemo(() => resolveImageName(imageUrl), [imageUrl]);
  const aspectRatio = naturalSize ? formatAspectRatio(naturalSize.width, naturalSize.height) : '';
  const fileSize = formatImageFileSize(meta?.imageSizeBytes);
  const imageStyle = resolvePreviewImageStyle(zoom, offset, rotation);

  useEffect(() => {
    setNaturalSize(null);
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setDragStart(null);
  }, [imageUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'r' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      rotatePreview(90);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  const rotatePreview = (degrees: number): void => {
    setRotation((current) => normalizeRotation(current + degrees));
  };

  const handlePreviewWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    const container = previewBodyRef.current;
    if (!container) {
      return;
    }

    const previousZoom = zoom;
    const nextZoom = clampZoom(previousZoom * Math.exp(-event.deltaY * 0.0008));
    if (nextZoom === previousZoom) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pointerX = event.clientX - containerRect.left - containerRect.width / 2;
    const pointerY = event.clientY - containerRect.top - containerRect.height / 2;
    const zoomRatio = nextZoom / previousZoom;

    setOffset((current) => ({
      x: pointerX - (pointerX - current.x) * zoomRatio,
      y: pointerY - (pointerY - current.y) * zoomRatio,
    }));
    setZoom(nextZoom);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (zoom <= 1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({
      offsetX: offset.x,
      offsetY: offset.y,
      pointerX: event.clientX,
      pointerY: event.clientY,
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragStart) {
      return;
    }

    setOffset({
      x: dragStart.offsetX + event.clientX - dragStart.pointerX,
      y: dragStart.offsetY + event.clientY - dragStart.pointerY,
    });
  };

  const handlePointerEnd = (): void => {
    setDragStart(null);
  };

  return (
    <div className="qr-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="telegram-image-modal-details">
        <div className="telegram-image-modal-details-title">{imageName}</div>
        <div className="telegram-image-modal-details-row">
          <span>Resolution</span>
          <strong>{naturalSize ? `${naturalSize.width} x ${naturalSize.height}` : 'Loading'}</strong>
        </div>
        <div className="telegram-image-modal-details-row">
          <span>Aspect</span>
          <strong>{aspectRatio || 'Loading'}</strong>
        </div>
        {fileSize ? (
          <div className="telegram-image-modal-details-row">
            <span>Size</span>
            <strong>{fileSize}</strong>
          </div>
        ) : null}
      </div>
      {sender || timestamp ? (
        <div className="telegram-image-modal-meta">
          {senderAvatarUrl ? (
            <img
              className="telegram-image-modal-avatar"
              src={senderAvatarUrl}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <div className="telegram-image-modal-avatar-fallback" aria-hidden="true">
              {(sender || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="telegram-image-modal-meta-text">
            {sender ? <div className="telegram-image-modal-sender">{sender}</div> : null}
            {timestamp ? <div className="telegram-image-modal-time">{timestamp}</div> : null}
          </div>
        </div>
      ) : null}
      <div className="telegram-image-modal-card">
        <header className="telegram-image-modal-header">
          <div className="telegram-image-modal-actions">
            <button
              type="button"
              className="ghost-button"
              aria-label="Rotate left"
              onClick={() => rotatePreview(-90)}
              title="Rotate left"
            >
              <ImageActionIcon name="rotate-left" />
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="Rotate right"
              onClick={() => rotatePreview(90)}
              title="Rotate right"
            >
              <ImageActionIcon name="rotate-right" />
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="Copy"
              title="Copy"
              onClick={onCopy}
            >
              <ImageActionIcon name="copy" />
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="Download"
              title="Download"
              onClick={onDownload}
            >
              <ImageActionIcon name="download" />
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <ImageActionIcon name="close" />
            </button>
          </div>
        </header>
        <div
          ref={previewBodyRef}
          className={`telegram-image-modal-body${zoom > 1 ? ' is-zoomed' : ''}${
            dragStart ? ' is-dragging' : ''
          }`}
          onWheel={handlePreviewWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <img
            className="telegram-image-preview"
            src={imageUrl}
            alt="Telegram image preview"
            style={imageStyle}
            onLoad={(event) => {
              const image = event.currentTarget;
              setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
            }}
          />
        </div>
      </div>
    </div>
  );
};

type ImageActionIconName = 'rotate-left' | 'rotate-right' | 'copy' | 'download' | 'close';

const ImageActionIcon = ({ name }: { name: ImageActionIconName }) => {
  const paths: Record<ImageActionIconName, ReactNode> = {
    'rotate-left': (
      <>
        <path d="M7 7H3V3" />
        <path d="M3.4 7.4A7 7 0 1 1 5 17.7" />
      </>
    ),
    'rotate-right': (
      <>
        <path d="M17 7h4V3" />
        <path d="M20.6 7.4A7 7 0 1 0 19 17.7" />
      </>
    ),
    copy: (
      <>
        <rect width="11" height="13" x="9" y="7" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
  };

  return (
    <svg
      className="telegram-image-action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

const clampZoom = (value: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

const resolvePreviewImageStyle = (
  zoom: number,
  offset: { x: number; y: number },
  rotation: number,
): CSSProperties | undefined => {
  if (zoom === 1 && offset.x === 0 && offset.y === 0 && rotation === 0) {
    return undefined;
  }

  return {
    transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`,
  };
};

const normalizeRotation = (degrees: number): number => ((degrees % 360) + 360) % 360;

const resolveImageName = (imageUrl: string): string => {
  if (imageUrl.startsWith('data:')) {
    const mime = imageUrl.slice(5, imageUrl.indexOf(';'));
    return mime ? `Image (${mime})` : 'Image';
  }

  try {
    const url = new URL(imageUrl);
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '').trim();
    return name || 'Image';
  } catch {
    const name = imageUrl.split(/[\\/]/).filter(Boolean).at(-1)?.trim();
    return name || 'Image';
  }
};

const formatAspectRatio = (width: number, height: number): string => {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
};

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
};

const formatImageFileSize = (bytes?: number): string => {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};
