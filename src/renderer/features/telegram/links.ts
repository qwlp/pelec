import { Fragment, createElement, useRef, type ReactNode } from 'react';
import type { ChatTextEntity } from '../../../shared/connectors';
import { safeText } from '../../lib/format';

const MESSAGE_LINK_PATTERN = /\b((?:https?:\/\/|mailto:|tg:\/\/|www\.)[^\s<]+)/giu;
const INLINE_LINK_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)\)/u;
const FENCED_CODE_BLOCK_PATTERN = /```([\s\S]*?)```/gu;
const TELEGRAM_USERNAME_PATTERN = /^@([A-Za-z][A-Za-z0-9_]{4,31})\b/u;

type TelegramInlineNode =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'strong'; children: TelegramInlineNode[] }
  | { type: 'em'; children: TelegramInlineNode[] }
  | { type: 'strike'; children: TelegramInlineNode[] }
  | { type: 'code'; text: string };

type TelegramBlockNode =
  | { type: 'paragraph'; children: TelegramInlineNode[] }
  | { type: 'pre'; text: string; language?: TelegramCodeLanguage };

type TelegramCodeToken = {
  text: string;
  className?: string;
};

type TelegramCodeLanguage =
  | 'bash'
  | 'javascript'
  | 'json'
  | 'python'
  | 'typescript';

const CODE_LANGUAGE_ALIASES: Record<string, TelegramCodeLanguage> = {
  bash: 'bash',
  console: 'bash',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  py: 'python',
  python: 'python',
  shell: 'bash',
  sh: 'bash',
  ts: 'typescript',
  typescript: 'typescript',
  zsh: 'bash',
};

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

const normalizeTelegramUsernameLink = (username: string): string =>
  `https://t.me/${encodeURIComponent(username)}`;

const canStartTelegramUsernameAt = (value: string, cursor: number): boolean => {
  if (cursor <= 0) {
    return true;
  }

  const previous = value[cursor - 1] ?? '';
  return !/[A-Za-z0-9_.+-]/u.test(previous);
};

const normalizeCodeLanguage = (
  language: string | undefined,
  codeText: string,
): TelegramCodeLanguage | undefined => {
  const normalized = language?.trim().toLowerCase();
  if (normalized && CODE_LANGUAGE_ALIASES[normalized]) {
    return CODE_LANGUAGE_ALIASES[normalized];
  }

  const trimmed = codeText.trim();
  if (!trimmed) {
    return undefined;
  }

  if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Ignore and fall back to heuristic detection.
    }
  }

  if (/\b(?:const|let|var|function|=>|console\.|document\.|await|async)\b/u.test(trimmed)) {
    return 'javascript';
  }
  if (/\b(?:interface|type|enum|implements|readonly)\b/u.test(trimmed)) {
    return 'typescript';
  }
  if (/\b(?:def|import|from|print|self|None|True|False)\b/u.test(trimmed)) {
    return 'python';
  }
  if (/\b(?:echo|cd|git|bun|npm|mkdir|rm|cp|mv|export)\b/u.test(trimmed)) {
    return 'bash';
  }

  return undefined;
};

const tokenizeCode = (
  source: string,
  matchers: Array<{ className: string; regex: RegExp }>,
): TelegramCodeToken[] => {
  const tokens: TelegramCodeToken[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    let matched = false;

    for (const matcher of matchers) {
      matcher.regex.lastIndex = cursor;
      const match = matcher.regex.exec(source);
      if (!match || match.index !== cursor) {
        continue;
      }
      const value = match[0] ?? '';
      if (!value) {
        continue;
      }
      tokens.push({ className: matcher.className, text: value });
      cursor += value.length;
      matched = true;
      break;
    }

    if (matched) {
      continue;
    }

    tokens.push({ text: source[cursor] ?? '' });
    cursor += 1;
  }

  return tokens;
};

const highlightTelegramCode = (
  text: string,
  language: TelegramCodeLanguage | undefined,
): TelegramCodeToken[] => {
  switch (language) {
    case 'json':
      return tokenizeCode(text, [
        { className: 'token-key', regex: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
        { className: 'token-string', regex: /"(?:\\.|[^"\\])*"/y },
        { className: 'token-number', regex: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy },
        { className: 'token-literal', regex: /\b(?:true|false|null)\b/y },
        { className: 'token-punctuation', regex: /[{}[\],:]/y },
      ]);
    case 'python':
      return tokenizeCode(text, [
        { className: 'token-comment', regex: /#[^\n]*/y },
        { className: 'token-string', regex: /(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/y },
        { className: 'token-keyword', regex: /\b(?:def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|raise|with|lambda|yield|async|await|pass|break|continue|True|False|None)\b/y },
        { className: 'token-number', regex: /\b\d+(?:\.\d+)?\b/y },
      ]);
    case 'bash':
      return tokenizeCode(text, [
        { className: 'token-comment', regex: /#[^\n]*/y },
        { className: 'token-string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { className: 'token-variable', regex: /\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[^}]+\}|[0-9@*#?$!-])/y },
        { className: 'token-keyword', regex: /\b(?:if|then|else|fi|for|in|do|done|case|esac|function|local|export|sudo)\b/y },
      ]);
    case 'typescript':
    case 'javascript':
      return tokenizeCode(text, [
        { className: 'token-comment', regex: /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/y },
        { className: 'token-string', regex: /`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { className: 'token-keyword', regex: /\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|extends|implements|interface|type|enum|public|private|protected|readonly)\b/y },
        { className: 'token-literal', regex: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y },
        { className: 'token-number', regex: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/y },
      ]);
    default:
      return text ? [{ text }] : [];
  }
};

const copyTelegramCodeText = async (value: string): Promise<boolean> => {
  try {
    if (window.navigator?.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy selection approach.
  }

  try {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', 'true');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    return copied;
  } catch {
    return false;
  }
};

const buildCodeTokenDomNodes = (text: string, language: TelegramCodeLanguage | undefined): Node[] =>
  highlightTelegramCode(text, language).map((token) => {
    if (!token.className) {
      return document.createTextNode(token.text);
    }
    const span = document.createElement('span');
    span.className = `telegram-code-token ${token.className}`;
    span.textContent = token.text;
    return span;
  });

const renderCodeTokenReactNodes = (
  text: string,
  language: TelegramCodeLanguage | undefined,
  keyPrefix: string,
): ReactNode[] =>
  highlightTelegramCode(text, language).map((token, index) =>
    token.className
      ? createElement(
          'span',
          {
            className: `telegram-code-token ${token.className}`,
            key: `${keyPrefix}:${index}`,
          },
          token.text,
        )
      : token.text,
  );

const clampEntityBounds = (value: string, entity: ChatTextEntity): { start: number; end: number } => {
  const start = Math.max(0, Math.min(value.length, entity.offset));
  const end = Math.max(start, Math.min(value.length, entity.offset + entity.length));
  return { start, end };
};

const buildEntityInlineNode = (
  value: string,
  entity: ChatTextEntity,
): TelegramInlineNode | undefined => {
  const { start, end } = clampEntityBounds(value, entity);
  const text = value.slice(start, end);
  if (!text) {
    return undefined;
  }

  switch (entity.type) {
    case 'bold':
      return { type: 'strong', children: [{ type: 'text', text }] };
    case 'italic':
      return { type: 'em', children: [{ type: 'text', text }] };
    case 'strikethrough':
      return { type: 'strike', children: [{ type: 'text', text }] };
    case 'underline':
      return { type: 'text', text };
    case 'spoiler':
      return { type: 'text', text };
    case 'code':
      return { type: 'code', text };
    case 'textUrl':
      return entity.url ? { type: 'link', href: entity.url, text } : { type: 'text', text };
    case 'url': {
      const href = normalizeExternalLink(text);
      return href ? { type: 'link', href, text } : { type: 'text', text };
    }
    default:
      return { type: 'text', text };
  }
};

const parseTelegramEntityRichText = (
  value: string,
  entities: ChatTextEntity[],
): TelegramBlockNode[] | null => {
  if (entities.length < 1) {
    return null;
  }

  const sorted = [...entities]
    .filter((entity) => entity.length > 0)
    .sort((a, b) => a.offset - b.offset || b.length - a.length);
  if (sorted.length < 1) {
    return null;
  }

  const preEntity = sorted.find((entity) => entity.offset === 0 && entity.length >= value.length && (
    entity.type === 'pre' || entity.type === 'preCode'
  ));
  if (preEntity) {
    return [{
      type: 'pre',
      text: value,
      language: normalizeCodeLanguage(preEntity.language, value),
    }];
  }

  const inlineEntities = sorted.filter((entity) => entity.type !== 'pre' && entity.type !== 'preCode');
  if (inlineEntities.length < 1) {
    return null;
  }

  const children: TelegramInlineNode[] = [];
  let cursor = 0;

  for (const entity of inlineEntities) {
    const { start, end } = clampEntityBounds(value, entity);
    if (start < cursor || end <= start) {
      continue;
    }
    if (start > cursor) {
      children.push(...parseInlineNodes(value.slice(cursor, start)));
    }
    const inlineNode = buildEntityInlineNode(value, entity);
    if (inlineNode) {
      children.push(inlineNode);
    }
    cursor = end;
  }

  if (cursor < value.length) {
    children.push(...parseInlineNodes(value.slice(cursor)));
  }

  return [{ type: 'paragraph', children }];
};

const parseInlineNodes = (value: string): TelegramInlineNode[] => {
  const nodes: TelegramInlineNode[] = [];
  let cursor = 0;

  const pushText = (text: string): void => {
    if (!text) {
      return;
    }
    const previous = nodes[nodes.length - 1];
    if (previous?.type === 'text') {
      previous.text += text;
      return;
    }
    nodes.push({ type: 'text', text });
  };

  while (cursor < value.length) {
    const remainder = value.slice(cursor);
    const inlineLinkMatch = INLINE_LINK_PATTERN.exec(remainder);
    if (inlineLinkMatch?.index === 0) {
      const href = normalizeExternalLink(inlineLinkMatch[2] ?? '');
      if (href) {
        nodes.push({
          type: 'link',
          text: inlineLinkMatch[1] ?? href,
          href,
        });
        cursor += inlineLinkMatch[0].length;
        continue;
      }
    }

    const urlMatch = MESSAGE_LINK_PATTERN.exec(remainder);
    MESSAGE_LINK_PATTERN.lastIndex = 0;
    if (urlMatch?.index === 0) {
      const { linkText, suffix } = trimLinkSuffix(urlMatch[0] ?? '');
      const href = normalizeExternalLink(linkText);
      if (href && linkText) {
        nodes.push({ type: 'link', text: linkText, href });
        if (suffix) {
          pushText(suffix);
        }
        cursor += urlMatch[0].length;
        continue;
      }
    }

    const usernameMatch = TELEGRAM_USERNAME_PATTERN.exec(remainder);
    if (usernameMatch?.index === 0 && canStartTelegramUsernameAt(value, cursor)) {
      const username = usernameMatch[1] ?? '';
      nodes.push({
        type: 'link',
        text: `@${username}`,
        href: normalizeTelegramUsernameLink(username),
      });
      cursor += usernameMatch[0].length;
      continue;
    }

    const inlineToken = [
      { token: '**', type: 'strong' as const },
      { token: '__', type: 'strong' as const },
      { token: '~~', type: 'strike' as const },
      { token: '`', type: 'code' as const },
      { token: '*', type: 'em' as const },
      { token: '_', type: 'em' as const },
    ].find(({ token }) => remainder.startsWith(token));

    if (inlineToken) {
      const closingIndex = value.indexOf(inlineToken.token, cursor + inlineToken.token.length);
      const inner = closingIndex >= 0
        ? value.slice(cursor + inlineToken.token.length, closingIndex)
        : '';
      if (closingIndex >= 0 && inner) {
        if (inlineToken.type === 'code') {
          nodes.push({ type: 'code', text: inner });
        } else {
          nodes.push({
            type: inlineToken.type,
            children: parseInlineNodes(inner),
          });
        }
        cursor = closingIndex + inlineToken.token.length;
        continue;
      }
    }

    pushText(value[cursor] ?? '');
    cursor += 1;
  }

  return nodes;
};

const parseTelegramRichText = (
  value: string,
  entities?: ChatTextEntity[],
): TelegramBlockNode[] => {
  const source = safeText(value);
  if (!source) {
    return [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }];
  }

  const entityBlocks = entities ? parseTelegramEntityRichText(source, entities) : null;
  if (entityBlocks) {
    return entityBlocks;
  }

  const blocks: TelegramBlockNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FENCED_CODE_BLOCK_PATTERN.lastIndex = 0;

  const pushParagraph = (text: string): void => {
    if (!text) {
      return;
    }
    blocks.push({
      type: 'paragraph',
      children: parseInlineNodes(text),
    });
  };

  while ((match = FENCED_CODE_BLOCK_PATTERN.exec(source)) !== null) {
    const matchText = match[0] ?? '';
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      pushParagraph(source.slice(lastIndex, matchIndex));
    }

    let codeText = match[1] ?? '';
    let declaredLanguage: string | undefined;
    if (codeText.startsWith('\n')) {
      codeText = codeText.slice(1);
    }
    const firstNewlineIndex = codeText.indexOf('\n');
    if (firstNewlineIndex > 0) {
      const maybeLanguage = codeText.slice(0, firstNewlineIndex).trim();
      if (/^[a-z0-9_+-]+$/iu.test(maybeLanguage)) {
        declaredLanguage = maybeLanguage;
        codeText = codeText.slice(firstNewlineIndex + 1);
      }
    }
    if (codeText.endsWith('\n')) {
      codeText = codeText.slice(0, -1);
    }
    blocks.push({
      type: 'pre',
      text: codeText,
      language: normalizeCodeLanguage(declaredLanguage, codeText),
    });
    lastIndex = matchIndex + matchText.length;
  }

  if (lastIndex < source.length) {
    pushParagraph(source.slice(lastIndex));
  }

  return blocks.length > 0
    ? blocks
    : [{ type: 'paragraph', children: [{ type: 'text', text: source }] }];
};

const buildLinkNode = (href: string, text: string): HTMLAnchorElement => {
  const link = document.createElement('a');
  link.className = 'telegram-message-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = text;
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void window.pelec.openExternal(href);
  });
  return link;
};

const buildInlineDomNodes = (nodes: TelegramInlineNode[]): Node[] =>
  nodes.reduce<Node[]>((result, node) => {
    switch (node.type) {
      case 'text':
        result.push(document.createTextNode(node.text));
        return result;
      case 'link':
        result.push(buildLinkNode(node.href, node.text));
        return result;
      case 'strong': {
        const element = document.createElement('strong');
        element.replaceChildren(...buildInlineDomNodes(node.children));
        result.push(element);
        return result;
      }
      case 'em': {
        const element = document.createElement('em');
        element.replaceChildren(...buildInlineDomNodes(node.children));
        result.push(element);
        return result;
      }
      case 'strike': {
        const element = document.createElement('s');
        element.replaceChildren(...buildInlineDomNodes(node.children));
        result.push(element);
        return result;
      }
      case 'code': {
        const element = document.createElement('code');
        element.className = 'telegram-message-inline-code';
        element.textContent = node.text;
        result.push(element);
        return result;
      }
      default:
        result.push(document.createTextNode(''));
        return result;
    }
  }, []);

export const buildLinkedTextNodes = (value: string, entities?: ChatTextEntity[]): Node[] => {
  const blocks = parseTelegramRichText(value, entities);
  if (blocks.length < 1) {
    return [document.createTextNode('')];
  }

  const nodes: Node[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index > 0 && block.type === 'paragraph' && blocks[index - 1]?.type === 'paragraph') {
      nodes.push(document.createElement('br'), document.createElement('br'));
    }
    if (block.type === 'pre') {
      const shell = document.createElement('div');
      shell.className = 'telegram-message-code-shell';
      const header = document.createElement('div');
      header.className = 'telegram-message-code-header';
      const language = document.createElement('span');
      language.className = 'telegram-message-code-language';
      language.textContent = block.language ?? 'code';
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'telegram-message-code-copy';
      copyButton.textContent = 'Copy';
      let resetTimer: number | null = null;
      copyButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyTelegramCodeText(block.text).then((copied) => {
          copyButton.textContent = copied ? 'Copied' : 'Copy failed';
          if (resetTimer !== null) {
            window.clearTimeout(resetTimer);
          }
          resetTimer = window.setTimeout(() => {
            resetTimer = null;
            copyButton.textContent = 'Copy';
          }, 1200);
        });
      });
      header.replaceChildren(language, copyButton);
      const pre = document.createElement('pre');
      pre.className = 'telegram-message-pre';
      const code = document.createElement('code');
      code.className = 'telegram-message-code-block';
      code.replaceChildren(...buildCodeTokenDomNodes(block.text, block.language));
      pre.replaceChildren(code);
      shell.replaceChildren(header, pre);
      nodes.push(shell);
      continue;
    }

    nodes.push(...buildInlineDomNodes(block.children));
  }

  return nodes.length > 0 ? nodes : [document.createTextNode('')];
};

const renderInlineReactNodes = (nodes: TelegramInlineNode[], keyPrefix: string): ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}:${index}`;
    switch (node.type) {
      case 'text':
        return node.text;
      case 'link':
        return createElement(
          'a',
          {
            className: 'telegram-message-link',
            href: node.href,
            key,
            onClick: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              void window.pelec.openExternal(node.href);
            },
            rel: 'noreferrer noopener',
            target: '_blank',
          },
          node.text,
        );
      case 'strong':
        return createElement('strong', { key }, ...renderInlineReactNodes(node.children, key));
      case 'em':
        return createElement('em', { key }, ...renderInlineReactNodes(node.children, key));
      case 'strike':
        return createElement('s', { key }, ...renderInlineReactNodes(node.children, key));
      case 'code':
        return createElement(
          'code',
          { className: 'telegram-message-inline-code', key },
          node.text,
        );
      default:
        return '';
    }
  });

const TelegramCodeBlock = ({
  language,
  text,
}: {
  language?: TelegramCodeLanguage;
  text: string;
}) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  return createElement(
    'div',
    { className: 'telegram-message-code-shell' },
    createElement(
      'div',
      { className: 'telegram-message-code-header' },
      createElement(
        'span',
        { className: 'telegram-message-code-language' },
        language ?? 'code',
      ),
      createElement(
        'button',
        {
          className: 'telegram-message-code-copy',
          onClick: (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            void copyTelegramCodeText(text).then((copied) => {
              if (buttonRef.current) {
                buttonRef.current.textContent = copied ? 'Copied' : 'Copy failed';
              }
              if (resetTimerRef.current !== null) {
                globalThis.clearTimeout(resetTimerRef.current);
              }
              resetTimerRef.current = globalThis.setTimeout(() => {
                resetTimerRef.current = null;
                if (buttonRef.current) {
                  buttonRef.current.textContent = 'Copy';
                }
              }, 1200);
            });
          },
          ref: buttonRef,
          type: 'button',
        },
        'Copy',
      ),
    ),
    createElement(
      'pre',
      { className: 'telegram-message-pre' },
      createElement(
        'code',
        { className: 'telegram-message-code-block' },
        ...renderCodeTokenReactNodes(text, language, `code:${language ?? 'plain'}`),
      ),
    ),
  );
};

export const renderTelegramRichText = (value: string, entities?: ChatTextEntity[]): ReactNode => {
  const blocks = parseTelegramRichText(value, entities);

  return blocks.map((block, index) => {
    if (block.type === 'pre') {
      return createElement(TelegramCodeBlock, {
        key: `pre:${index}`,
        language: block.language,
        text: block.text,
      });
    }

    if (blocks.length === 1) {
      return createElement(
        Fragment,
        { key: `paragraph:${index}` },
        ...renderInlineReactNodes(block.children, `paragraph:${index}`),
      );
    }

    return createElement(
      'div',
      { className: 'telegram-message-paragraph', key: `paragraph:${index}` },
      ...renderInlineReactNodes(block.children, `paragraph:${index}`),
    );
  });
};
