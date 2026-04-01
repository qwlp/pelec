/* eslint-disable import/no-unresolved */
import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config
export default defineConfig(async () => {
  const react = (await import('@vitejs/plugin-react')).default;

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['src/renderer/test/setup.ts'],
      include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    },
  };
});
