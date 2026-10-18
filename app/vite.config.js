import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// During `npm run dev` the UI talks to a local PocketBase (see README: pocketbase serve --http 127.0.0.1:8090).
const PB = process.env.VITE_PB_PROXY || 'http://127.0.0.1:8090'

export default defineConfig({
  logLevel: 'error',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: { '/api': { target: PB, changeOrigin: true } },
  },
  build: { outputDir: undefined, chunkSizeWarningLimit: 2500 },
})
