import { useDeferredValue, useEffect, useMemo, useRef } from 'react';

export interface CommandPaletteItem {
  id: string;
  label: string;
  group: 'actions' | 'mode' | 'network' | 'system';
}

interface CommandPaletteProps {
  items: CommandPaletteItem[];
  onClose(): void;
  onExecute(item: CommandPaletteItem): void;
  onQueryChange(query: string): void;
  onSelectedIndexChange(index: number): void;
  query: string;
  selectedIndex: number;
}

export const CommandPalette = ({
  items,
  onClose,
  onExecute,
  onQueryChange,
  onSelectedIndexChange,
  query,
  selectedIndex,
}: CommandPaletteProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const deferredQuery = useDeferredValue(query);
  const filteredItems = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => item.label.toLowerCase().includes(normalizedQuery));
  }, [deferredQuery, items]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (filteredItems.length < 1) {
      onSelectedIndexChange(0);
      return;
    }

    if (selectedIndex > filteredItems.length - 1) {
      onSelectedIndexChange(0);
    }
  }, [filteredItems.length, onSelectedIndexChange, selectedIndex]);

  return (
    <div className="modern-modal-backdrop" role="presentation">
      <section className="modern-command-palette" aria-label="Command palette">
        <input
          ref={inputRef}
          className="modern-command-input"
          placeholder="Run a command"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
              return;
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault();
              onSelectedIndexChange(Math.min(filteredItems.length - 1, selectedIndex + 1));
              return;
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onSelectedIndexChange(Math.max(0, selectedIndex - 1));
              return;
            }

            if (event.key === 'Enter') {
              event.preventDefault();
              const item = filteredItems[selectedIndex];
              if (item) {
                onExecute(item);
              }
            }
          }}
        />
        <div className="modern-command-results">
          {filteredItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`modern-command-item${index === selectedIndex ? ' selected' : ''}`}
              onMouseEnter={() => onSelectedIndexChange(index)}
              onClick={() => onExecute(item)}
            >
              <span>{item.label}</span>
              <span className="modern-command-group">{item.group}</span>
            </button>
          ))}
          {filteredItems.length < 1 ? (
            <div className="modern-command-empty">No matching commands.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
};
