import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/momentum-stock-replay/',
  resolve: {
    alias: {
      // Point to the built dist file for oakscriptjs
      '@deepentropy/oakscriptjs': resolve(__dirname, 'node_modules/@deepentropy/oakscriptjs/oakscriptjs/dist/index.mjs'),
      // oakview package needs to be built separately - this alias allows build to pass
      // TODO: Once oakview dist is available, update this to point to the actual module
      '@deepentropy/oakview': resolve(__dirname, 'node_modules/@deepentropy/oakview/src/data-providers/types.d.ts'),
      // Use local replay-engine source for development
      '@momentum/replay-engine': resolve(__dirname, '../packages/replay-engine/src'),
    },
  },
})