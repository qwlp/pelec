import { BrowserWindow, clipboard, Menu, shell } from 'electron';

const buildWebviewContextMenu = (
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): Menu => {
  const history = contents.navigationHistory;
  const hasSelection = params.selectionText.trim().length > 0;
  const hasLink = params.linkURL.trim().length > 0;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Back',
      enabled: history.canGoBack(),
      click: () => {
        if (!contents.isDestroyed() && contents.navigationHistory.canGoBack()) {
          contents.navigationHistory.goBack();
        }
      },
    },
    {
      label: 'Forward',
      enabled: history.canGoForward(),
      click: () => {
        if (!contents.isDestroyed() && contents.navigationHistory.canGoForward()) {
          contents.navigationHistory.goForward();
        }
      },
    },
    {
      label: 'Reload',
      click: () => {
        if (!contents.isDestroyed()) {
          contents.reload();
        }
      },
    },
  ];

  if (hasLink || hasSelection || params.isEditable) {
    template.push({ type: 'separator' });
  }

  if (hasLink) {
    template.push(
      {
        label: 'Open Link in Browser',
        click: () => {
          void shell.openExternal(params.linkURL);
        },
      },
      {
        label: 'Copy Link Address',
        click: () => {
          clipboard.writeText(params.linkURL);
        },
      },
    );
  }

  if (params.isEditable) {
    template.push(
      {
        label: 'Cut',
        enabled: params.editFlags.canCut,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.cut();
          }
        },
      },
      {
        label: 'Copy',
        enabled: params.editFlags.canCopy,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.copy();
          }
        },
      },
      {
        label: 'Paste',
        enabled: params.editFlags.canPaste,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.paste();
          }
        },
      },
      {
        label: 'Select All',
        enabled: params.editFlags.canSelectAll,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.selectAll();
          }
        },
      },
    );
  } else if (hasSelection) {
    template.push({
      label: 'Copy',
      enabled: params.editFlags.canCopy,
      click: () => {
        if (!contents.isDestroyed()) {
          contents.copy();
        }
      },
    });
  }

  return Menu.buildFromTemplate(template);
};

export const installWebviewContextMenu = (contents: Electron.WebContents): void => {
  contents.on('context-menu', (event, params) => {
    event.preventDefault();
    const ownerWindow = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents);
    buildWebviewContextMenu(contents, params).popup({
      window: ownerWindow ?? undefined,
    });
  });
};
