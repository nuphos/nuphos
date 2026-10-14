import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('persisted reply image references survive Markdown sanitizing and reach the attachment renderer', async () => {
  const server = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  try {
    const { MessageResponse } = await server.ssrLoadModule(
      '/src/components/agent/MessageResponse.tsx',
    )
    const result = renderToString(
      React.createElement(MessageResponse, {
        teamId: 'test',
        children: '![screen](https://nuphos.ai/_reply-images/0123456789abcdef01234567)',
      }),
    )
    assert.ok(result.replaceAll('<!-- -->', '').includes('Loading screen'))
    assert.ok(!result.includes('src="https://nuphos.ai/_reply-images/'))
  } finally {
    await server.close()
  }
})
