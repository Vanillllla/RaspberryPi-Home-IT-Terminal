import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.TERMINAL_API || 'http://127.0.0.1:8000'
const project = fileURLToPath(new URL('../', import.meta.url))
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@terminal/element': fileURLToPath(new URL('./src/engine/element.ts', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('./', import.meta.url)), project + 'elements', project + 'docs'] },
    proxy: {
      '/api/events': { target: backend, ws: true },
      '/api': backend,
    },
  },
})
