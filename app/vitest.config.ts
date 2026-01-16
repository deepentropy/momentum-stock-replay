import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules'],
  },
  resolve: {
    alias: {
      '@momentum/replay-engine': resolve(__dirname, '../packages/replay-engine/src/index.ts'),
    },
  },
});
