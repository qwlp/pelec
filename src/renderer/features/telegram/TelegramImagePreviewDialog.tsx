interface TelegramImagePreviewDialogProps {
  imageUrl: string;
  onClose(): void;
  onCopy(): void;
  onDownload(): void;
}

export const TelegramImagePreviewDialog = ({
  imageUrl,
  onClose,
  onCopy,
  onDownload,
}: TelegramImagePreviewDialogProps) => (
  <div className="qr-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <div className="telegram-image-modal-card">
      <header className="telegram-image-modal-header">
        <div className="telegram-image-modal-title">Preview</div>
        <div className="telegram-image-modal-actions">
          <button type="button" className="ghost-button" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="ghost-button" onClick={onDownload}>
            Download
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div className="telegram-image-modal-body">
        <img className="telegram-image-preview" src={imageUrl} alt="Telegram image preview" />
      </div>
    </div>
  </div>
);
