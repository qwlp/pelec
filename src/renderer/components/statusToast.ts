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

  const eyebrow = document.createElement('div');
  eyebrow.className = 'status-toast-eyebrow';
  eyebrow.textContent =
    activity.state === 'running'
      ? 'Background task'
      : activity.state === 'success'
        ? 'Completed'
        : 'Attention';

  const header = document.createElement('div');
  header.className = 'status-toast-header';

  const label = document.createElement('div');
  label.className = 'status-toast-label';
  label.textContent = activity.label;

  const value = document.createElement('div');
  value.className = 'status-toast-value';
  if (typeof activity.progress === 'number' && Number.isFinite(activity.progress)) {
    value.textContent = `${Math.round(Math.max(0, Math.min(activity.progress, 1)) * 100)}%`;
  } else if (activity.state === 'running') {
    value.textContent = 'WORKING';
  } else {
    value.textContent = activity.state.toUpperCase();
  }

  const detail = document.createElement('div');
  detail.className = 'status-toast-detail';
  detail.textContent = activity.detail?.trim() || '\u00a0';

  const track = document.createElement('div');
  track.className = 'status-toast-track';
  const bar = document.createElement('div');
  bar.className = 'status-toast-bar';
  if (
    !activity.indeterminate &&
    typeof activity.progress === 'number' &&
    Number.isFinite(activity.progress)
  ) {
    bar.style.width = `${Math.max(0, Math.min(activity.progress, 1)) * 100}%`;
  }
  track.append(bar);

  header.replaceChildren(label, value);
  card.replaceChildren(eyebrow, header, detail, track);
  host.append(card);
};
