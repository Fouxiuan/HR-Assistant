import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
