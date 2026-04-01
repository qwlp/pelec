import { app } from 'electron';
import { spawnSync } from 'node:child_process';

export const showLinuxNotification = (title: string, body: string): boolean => {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const result = spawnSync(
      'notify-send',
      ['-a', app.getName(), '-t', '5000', title, body],
      { stdio: 'ignore' },
    );
    return result.status === 0;
  } catch {
    return false;
  }
};

const commandExists = (command: string): boolean => {
  try {
    return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

export const writeLinuxClipboardWithUtility = (fileUrl: string): boolean => {
  const payload = `copy\n${fileUrl}\n`;

  if (process.env.WAYLAND_DISPLAY && commandExists('wl-copy')) {
    try {
      return (
        spawnSync('wl-copy', ['--type', 'x-special/gnome-copied-files'], {
          input: payload,
          stdio: ['pipe', 'ignore', 'ignore'],
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  if (commandExists('xclip')) {
    try {
      return (
        spawnSync(
          'xclip',
          ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files', '-i'],
          {
            input: payload,
            stdio: ['pipe', 'ignore', 'ignore'],
          },
        ).status === 0
      );
    } catch {
      return false;
    }
  }

  return false;
};
