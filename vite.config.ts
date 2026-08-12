import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base is relative so the built app can be opened from any sub-path or static host.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Dev: run `npm run server` alongside `npm run dev` — /api is proxied to Express.
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
