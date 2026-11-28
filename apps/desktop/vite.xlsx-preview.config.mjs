import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  root: 'test-fixtures/xlsx-preview',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 52387, strictPort: true, fs: { allow: ['../..'] } },
})
