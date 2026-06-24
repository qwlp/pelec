import { execFile } from 'node:child_process';

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });

const normalizeFamilies = (families: string[]): string[] => {
  const unique = new Map<string, string>();

  for (const family of families) {
    const trimmed = family.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLocaleLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }

  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' }),
  );
};

const listLinuxFonts = async (): Promise<string[]> => {
  const output = await run('fc-list', ['--format=%{family}\n']);
  return normalizeFamilies(output.split(/\r?\n/).flatMap((line) => line.split(',')));
};

const listMacFonts = async (): Promise<string[]> => {
  const script = [
    'ObjC.import("AppKit");',
    'const families = ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies);',
    'JSON.stringify(families);',
  ].join(' ');
  const output = await run('osascript', ['-l', 'JavaScript', '-e', script]);
  const families: unknown = JSON.parse(output);
  return normalizeFamilies(Array.isArray(families) ? families.filter((item): item is string => typeof item === 'string') : []);
};

const listWindowsFonts = async (): Promise<string[]> => {
  const script = [
    'Add-Type -AssemblyName System.Drawing;',
    '$fonts = New-Object System.Drawing.Text.InstalledFontCollection;',
    '$fonts.Families | ForEach-Object { $_.Name };',
  ].join(' ');
  const output = await run('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  return normalizeFamilies(output.split(/\r?\n/));
};

export const listInstalledFonts = async (): Promise<string[]> => {
  try {
    if (process.platform === 'darwin') {
      return await listMacFonts();
    }
    if (process.platform === 'win32') {
      return await listWindowsFonts();
    }
    return await listLinuxFonts();
  } catch (error) {
    console.warn('Could not enumerate installed fonts.', error);
    return [];
  }
};
