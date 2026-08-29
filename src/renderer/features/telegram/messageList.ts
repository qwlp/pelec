import type { ChatMessage } from '../../../shared/connectors';

export const replaceTelegramMessageText = (
  messages: ChatMessage[],
  messageId: string,
  text: string,
): ChatMessage[] => {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) {
    return messages;
  }

  const nextMessages = [...messages];
  nextMessages[messageIndex] = {
    ...messages[messageIndex],
    text,
    textEntities: undefined,
  };
  return nextMessages;
};

export const syncTelegramMessageListNodes = (
  container: HTMLElement,
  nextNodes: HTMLElement[],
): void => {
  const nextNodeSet = new Set(nextNodes);

  for (const child of [...container.children]) {
    if (!(child instanceof HTMLElement) || nextNodeSet.has(child)) {
      continue;
    }
    container.removeChild(child);
  }

  for (const [index, node] of nextNodes.entries()) {
    const currentNode = container.children.item(index);
    if (currentNode === node) {
      continue;
    }
    container.insertBefore(node, currentNode);
  }
};
