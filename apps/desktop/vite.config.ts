import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

import { buildSidebarGestures } from './scripts/build-sidebar-gestures.ts'

import type { Plugin } from 'vite'

/**
 * Nothing edits the source while the e2e suite runs, so a scenario's reload has nothing to
 * revalidate. Under Vite's `no-cache` every reload asked the dev server about ~2,100 modules
 * at once; on a loaded machine the tail of that burst came back ERR_INSUFFICIENT_RESOURCES,
 * the module graph never finished, and the window stayed blank for the rest of the run
 * (#4199). The document itself still comes from the server, so a reload is still a reload.
 */
const keepModulesCached: Plugin = {
  name: 'e2e-keep-modules-cached',
  apply: 'serve',
  configureServer: (server) => {
    if (!process.env.NUPHOS_E2E) return
    server.middlewares.use((request, response, next) => {
      // A navigation asks for text/html; a module script asks for */*.
      if (request.headers.accept?.includes('text/html')) return next()
      const setHeader = response.setHeader.bind(response)

      response.setHeader = (name: string, value: number | string | readonly string[]) =>
        setHeader(
          name,
          name.toLowerCase() === 'cache-control' ? 'public, max-age=31536000, immutable' : value,
        )
      next()
    })
  },
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    { name: 'sidebar-native-gestures', buildStart: buildSidebarGestures },
    keepModulesCached,
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
                'undici',
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
