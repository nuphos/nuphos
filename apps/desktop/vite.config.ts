import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  base: './',
  plugins: [
    react(),
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
                '@napi-rs/keyring',
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
  ],
  build: {
    outDir: 'dist',
  },
  server: {
    fs: {
      // The renderer imports packages/kube-insight from outside this app's
      // root; the dev server refuses to serve files it was not told about.
      allow: [searchForWorkspaceRoot(process.cwd()), '../../packages/kube-insight'],
    },
  },
})
