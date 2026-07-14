import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 7777,
    proxy: {
      '/api': {
        target: 'http://localhost:7778',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:7778',
        ws: true,
      },
      '/gmo-public': {
        target: 'https://forex-api.coin.z.com/public',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gmo-public/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
