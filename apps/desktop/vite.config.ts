import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

const skipElectron = process.env.NO_ELECTRON === '1'

// In `dev:web` mode (browser-only, no Electron), the renderer can't use the
// IPC bridge to authenticate. Inject an explicit local Nuphos token via the
// server-side proxy at /atlas-api/* so the shim can fetch as if it were the
// Electron main process.
const atlasUrl = process.env.NUPHOS_API_URL || process.env.ATLAS_API_URL || 'http://localhost:3717'
const devAuthToken = process.env.NUPHOS_AUTH_TOKEN || process.env.ATLAS_AUTH_TOKEN || null

export default defineConfig({
  base: './',
  server: {
    proxy: skipElectron
      ? {
          '/atlas-api': {
            target: atlasUrl,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/atlas-api/, ''),
            secure: false,
            configure: (proxy) => {
              if (!devAuthToken) return
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.setHeader('authorization', `Bearer ${devAuthToken}`)
                // Same workaround as the Electron client: avoid the backend's
                // mishandled gzip Content-Encoding.
                proxyReq.setHeader('accept-encoding', 'identity')
              })
            },
          },
        }
      : undefined,
  },
  plugins: [
    react(),
    !skipElectron &&
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: [
                  '@kubernetes/client-node',
                  'node-pty',
                  'electron-updater',
                  'ws',
                  'posthog-node',
                  'archiver',
                ],
              },
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                },
              },
            },
          },
        },
      }),
  ].filter(Boolean),
  build: {
    outDir: 'dist',
  },
})
