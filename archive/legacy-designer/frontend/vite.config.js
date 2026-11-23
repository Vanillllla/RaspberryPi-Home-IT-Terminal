import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const project = fileURLToPath(new URL('../', import.meta.url))
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@terminal/plugin': fileURLToPath(new URL('./src/plugin.ts', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('./', import.meta.url)), project + 'plugins'] },
    proxy: {
      '/api/events': { target: 'http://127.0.0.1:8000', ws: true },
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
