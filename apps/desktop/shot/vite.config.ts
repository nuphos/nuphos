import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
export default defineConfig({ root: __dirname, base: './', plugins: [react()], build: { outDir: __dirname + '/dist', emptyOutDir: true } })
