import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/momentum-stock-replay/',
  resolve: {
    alias: {
      '@deepentropy/oakscriptjs': resolve(__dirname, 'node_modules/@deepentropy/oakscriptjs/oakscriptjs'),
      '@deepentropy/oakview': resolve(__dirname, 'node_modules/@deepentropy/oakview'),
      '@momentum/replay-engine': resolve(__dirname, '../packages/replay-engine/src'),
    },
  },
})