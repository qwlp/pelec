import { BrowserWindow } from 'electron';
import type { AppActivity } from '../shared/types';

export const emitAppActivity = (activity: AppActivity): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app:activity', activity);
  }
};
