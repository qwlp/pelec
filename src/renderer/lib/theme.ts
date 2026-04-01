import type { UserConfig } from '../../shared/types';

export const applyUserTheme = (userConfig: UserConfig): void => {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--window-padding', `${userConfig.appearance.windowPadding}px`);
  rootStyle.setProperty(
    '--window-border-radius',
    `${userConfig.appearance.windowBorderRadius}px`,
  );
  rootStyle.setProperty('--app-font-family', userConfig.appearance.fontFamily);
  rootStyle.setProperty('--app-font-size', `${userConfig.appearance.fontSize}px`);
  rootStyle.setProperty('--font-scale', String(userConfig.appearance.fontSize / 14));
  rootStyle.setProperty(
    '--background-opacity',
    String(userConfig.appearance.backgroundOpacity),
  );
  rootStyle.setProperty('--text-opacity', String(userConfig.appearance.textOpacity));
};
