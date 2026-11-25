import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:8765'
const media = process.env.MEDIA_TARGET || backend
const localApi = { target:backend, changeOrigin:true, configure(proxy){proxy.on('proxyReq',request=>request.setHeader('origin',backend))} }

export default defineConfig({
  plugins: [react()],
  // This adaptation uses FastAPI coaching; upstream coach.test.js imports its unused Node service.
  test: { exclude: ['**/node_modules/**','**/dist/**','src/lib/coach.test.js'] },
  base: './',
  server: {
    proxy: {
      '/api': localApi,
      '/analytics': localApi,
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
