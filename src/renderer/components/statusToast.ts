import type { AppActivity } from '../../shared/types';

export const renderStatusToast = (host: HTMLElement, activity?: AppActivity | null): void => {
  host.replaceChildren();
  host.classList.toggle('hidden', !activity);
  if (!activity) {
    return;
  }

  const card = document.createElement('aside');
  card.className = 'status-toast';
  card.classList.add(`state-${activity.state}`);
  if (activity.indeterminate) {
    card.classList.add('indeterminate');
  }

  const icon = document.createElement('div');
  icon.className = 'status-toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (activity.state === 'success') {
    icon.textContent = '✓';
  } else if (activity.state === 'error') {
    icon.textContent = '!';
  }

  const label = document.createElement('div');
  label.className = 'status-toast-label';
  label.textContent = activity.label;

  const content = document.createElement('div');
  content.className = 'status-toast-content';
  content.append(label);

  const detailText = activity.state === 'error' ? activity.detail?.trim() : '';
  if (detailText) {
    const detail = document.createElement('div');
    detail.className = 'status-toast-detail';
    detail.textContent = detailText;
    content.append(detail);
  }

  card.replaceChildren(icon, content);
  host.append(card);
};
