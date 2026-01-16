import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// Plugin to serve local sessions directory
function localSessionsPlugin() {
  return {
    name: 'local-sessions',
    configureServer(server) {
      server.middlewares.use('/local-sessions', (req, res, next) => {
        const sessionsDir = path.resolve(__dirname, '../sessions')
        const filePath = path.join(sessionsDir, req.url)

        // List directory for API endpoint
        if (req.url === '/' || req.url === '') {
          try {
            const files = fs.readdirSync(sessionsDir)
            const sessions = files
              .filter(f => f.endsWith('.bin.gz') && !f.endsWith('-l2.bin.gz'))
              .map(f => ({
                name: f,
                size: fs.statSync(path.join(sessionsDir, f)).size
              }))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(sessions))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        // Serve binary file
        try {
          const data = fs.readFileSync(filePath)
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(data)
        } catch (err) {
          res.statusCode = 404
          res.end('File not found')
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localSessionsPlugin()],
  base: '/momentum-stock-replay/',
  server: {
    fs: {
      allow: ['..'] // Allow serving files from parent directory
    }
  }
})