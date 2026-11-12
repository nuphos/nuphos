import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

import { buildSidebarGestures } from './scripts/build-sidebar-gestures.ts'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    { name: 'sidebar-native-gestures', buildStart: buildSidebarGestures },
    electron({
      main: {
        entry: 'electron/main.ts',
        // The plugin starts Electron with --no-sandbox, and Electron then runs no
        // preload in extension service workers, so their chrome.* APIs are missing.
        // Packaged builds are sandboxed; dev matches them outside Linux.
        onstart: ({ startup }) =>
          startup(process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.']),
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
                'electron-chrome-extensions',
              ],
            },
          },
        },
      },
      preload: {
        // `browser-preload` runs in Dock browser pages (see webview-guard.ts).
        input: { preload: 'electron/preload.ts', 'browser-preload': 'electron/browser-preload.ts' },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
                // Two entries need it on; neither imports the other or anything dynamic, so no chunks.
                codeSplitting: true,
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
})
