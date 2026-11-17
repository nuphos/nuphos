import { Sandbox } from '@insforge/instabox-sdk'
import { expect, test } from 'bun:test'

// createBox answers once instabox accepts the order, and it tells acceptance by the 2xx of
// the only POST that Sandbox.create sends. An SDK that sends another POST first would make
// that answer wrong, so a version that does fails here rather than in production.
test('Sandbox.create sends exactly one POST: the order', async () => {
  const posts: string[] = []
  const fetch = Object.assign(
    async (...[input, init]: Parameters<typeof globalThis.fetch>) => {
      const { pathname } = new URL(input instanceof Request ? input.url : input)

      if (init?.method === 'POST') posts.push(pathname)
      if (pathname === '/v1/templates')
        return Response.json({ templates: [{ id: 'agent-browser' }] })
      if (pathname === '/v1/machines')
        return Response.json(
          { id: 'op_1', type: 'create', state: 'succeeded', machineId: 'm_1' },
          { status: 202 },
        )

      return Response.json({ id: 'm_1', name: 'box', state: 'running' })
    },
    { preconnect: globalThis.fetch.preconnect },
  )

  const sandbox = await Sandbox.create('agent-browser', {
    apiKey: 'k',
    apiUrl: 'https://instabox.test',
    fetch,
    autoSuspendMs: 0,
    vault: false,
  })

  expect(sandbox.sandboxId).toBe('m_1')
  expect(posts).toEqual(['/v1/machines'])
})
