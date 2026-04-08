import type { NetworkId } from '../../../shared/types';

interface NetworkRailProps {
  activeNetwork: NetworkId;
  onActivateNetwork(network: NetworkId): void;
}

export const NetworkRail = ({ activeNetwork, onActivateNetwork }: NetworkRailProps) => {
  return (
    <aside className="modern-network-rail" aria-label="Quick network switch">
      <button
        type="button"
        className={`modern-network-pill${activeNetwork === 'telegram' ? ' active' : ''}`}
        onClick={() => onActivateNetwork('telegram')}
      >
        Telegram
      </button>
    </aside>
  );
};
