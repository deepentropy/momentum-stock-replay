import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/momentum-stock-replay/',
  resolve: {
    alias: {
      // Use local replay-engine source for development
      '@momentum/replay-engine': resolve(__dirname, '../packages/replay-engine/src'),
    },
  },
})