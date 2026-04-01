import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.querySelector<HTMLDivElement>('#app');

if (!rootElement) {
  throw new Error('App root not found');
}

createRoot(rootElement).render(<App />);
