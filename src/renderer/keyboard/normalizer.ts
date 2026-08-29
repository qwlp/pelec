export interface NormalizedKeyboardEvent {
  code: string;
  isTypingTarget: boolean;
  key: string;
  mod: boolean;
  signature: string;
}

const isTypingElement = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable
  );
};

const toPhysicalCode = (bindingKey: string): string | null => {
  if (/^[a-z]$/i.test(bindingKey)) {
    return `Key${bindingKey.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(bindingKey)) {
    return `Digit${bindingKey}`;
  }
  if (bindingKey === '/') {
    return 'Slash';
  }
  if (bindingKey === '[') {
    return 'BracketLeft';
  }
  return null;
};

export const normalizeKeyboardEvent = (event: KeyboardEvent): NormalizedKeyboardEvent => {
  const key = event.key.length === 1 ? event.key : event.key;
  const pieces: string[] = [];

  if (event.ctrlKey) {
    pieces.push('Ctrl');
  }
  if (event.metaKey) {
    pieces.push('Meta');
  }
  if (event.altKey) {
    pieces.push('Alt');
  }
  if (event.shiftKey && key !== 'Shift') {
    pieces.push('Shift');
  }

  pieces.push(key);

  return {
    code: event.code,
    isTypingTarget: isTypingElement(event.target),
    key,
    mod: event.ctrlKey || event.metaKey,
    signature: pieces.join('+'),
  };
};

export const matchesBinding = (
  normalizedEvent: NormalizedKeyboardEvent,
  binding: string,
): boolean => {
  const bindingParts = binding.split('+');
  const bindingKey = bindingParts[bindingParts.length - 1] ?? '';
  const normalizedBinding = binding.replace('CommandOrControl', normalizedEvent.mod ? 'Ctrl' : 'Meta');
  if (binding === 'CommandOrControl+K') {
    return normalizedEvent.mod && (normalizedEvent.code === 'KeyK' || normalizedEvent.key.toLowerCase() === 'k');
  }
  if (binding === 'CommandOrControl+[') {
    return normalizedEvent.mod && (normalizedEvent.code === 'BracketLeft' || normalizedEvent.key === '[');
  }

  const physicalCode = toPhysicalCode(bindingKey);
  if (physicalCode && normalizedEvent.code) {
    const normalizedPhysicalBinding = bindingParts
      .slice(0, -1)
      .map((part) => (part === 'CommandOrControl' ? (normalizedEvent.mod ? 'Ctrl' : 'Meta') : part))
      .concat(physicalCode)
      .join('+');
    const eventPhysicalSignature = normalizedEvent.signature
      .split('+')
      .slice(0, -1)
      .concat(normalizedEvent.code)
      .join('+');
    if (eventPhysicalSignature.toLowerCase() === normalizedPhysicalBinding.toLowerCase()) {
      return true;
    }
  }

  return normalizedEvent.signature.toLowerCase() === normalizedBinding.toLowerCase();
};
