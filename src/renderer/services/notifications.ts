export const sendTestNotification = async (): Promise<boolean> => {
  return window.pelec.showNotification('PELEC', 'Keyboard and shell modernization is active.');
};
