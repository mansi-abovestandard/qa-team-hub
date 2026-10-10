import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || '4411'}` },
  },
})
