import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from /<repository name>/.
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
})
