import { safeText } from '../../lib/format';

const MESSAGE_LINK_PATTERN = /\b((?:https?:\/\/|mailto:|tg:\/\/|www\.)[^\s<]+)/giu;

const trimLinkSuffix = (value: string): { linkText: string; suffix: string } => {
  let end = value.length;
  while (end > 0) {
    const current = value[end - 1];
    if (
      current === '.' ||
      current === ',' ||
      current === '!' ||
      current === '?' ||
      current === ':' ||
      current === ';'
    ) {
      end -= 1;
      continue;
    }
    if (current === ')' || current === ']' || current === '}') {
      const openChar = current === ')' ? '(' : current === ']' ? '[' : '{';
      const candidate = value.slice(0, end);
      const openCount = [...candidate].filter((char) => char === openChar).length;
      const closeCount = [...candidate].filter((char) => char === current).length;
      if (closeCount > openCount) {
        end -= 1;
        continue;
      }
    }
    break;
  }

  return {
    linkText: value.slice(0, end),
    suffix: value.slice(end),
  };
};

const normalizeExternalLink = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^(?:https?:\/\/|mailto:|tg:\/\/)/iu.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./iu.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return undefined;
};

export const buildLinkedTextNodes = (value: string): Node[] => {
  const source = safeText(value);
  if (!source) {
    return [document.createTextNode('')];
  }

  const nodes: Node[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MESSAGE_LINK_PATTERN.lastIndex = 0;

  while ((match = MESSAGE_LINK_PATTERN.exec(source)) !== null) {
    const fullMatch = match[0];
    const matchIndex = match.index;
    const { linkText, suffix } = trimLinkSuffix(fullMatch);
    const href = normalizeExternalLink(linkText);
    const consumedLength = linkText.length + suffix.length;

    if (!href || !linkText) {
      continue;
    }

    if (matchIndex > lastIndex) {
      nodes.push(document.createTextNode(source.slice(lastIndex, matchIndex)));
    }

    const link = document.createElement('a');
    link.className = 'telegram-message-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = linkText;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void window.pelec.openExternal(href);
    });
    nodes.push(link);

    if (suffix) {
      nodes.push(document.createTextNode(suffix));
    }

    lastIndex = matchIndex + consumedLength;
  }

  if (lastIndex < source.length) {
    nodes.push(document.createTextNode(source.slice(lastIndex)));
  }

  return nodes.length > 0 ? nodes : [document.createTextNode(source)];
};
