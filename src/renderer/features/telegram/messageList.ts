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
