import { expect, test } from 'bun:test'

import { fetchStatusz } from './runtime-statusz'

test('managed runtimes report the running version even with the console disabled', async () => {
  let html = '<dt>Version</dt><dd>0.1.2</dd>'
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname

      if (path === '/statusz') return Response.json({ uptime_seconds: 10 })
      if (path === '/') return new Response(html)

      return new Response('', { status: 404 })
    },
  })

  try {
    const status = await fetchStatusz(`ws://localhost:${server.port}/acp`)

    expect(status?.statusz.runtimeVersion).toBe('0.1.2')
    expect(status?.statusz.uptimeSeconds).toBe(10)
    html = '<dt>Version</dt>\n  <dd>0.1.3</dd>'
    expect((await fetchStatusz(`ws://localhost:${server.port}/acp`))?.statusz.runtimeVersion).toBe(
      '0.1.3',
    )
    html = '<dt>Build</dt><dd>0.1.4</dd>'
    expect(
      (await fetchStatusz(`ws://localhost:${server.port}/acp`))?.statusz.runtimeVersion,
    ).toBeUndefined()
  } finally {
    await server.stop(true)
  }
})
test('external console version is read and a missing version is not guessed from the target image', async () => {
  let version: string | undefined = '0.1.4'
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/_openab/console/state')
        return Response.json({ version })

      return Response.json({ uptime_seconds: 10 })
    },
  })

  try {
    expect((await fetchStatusz(`ws://localhost:${server.port}/acp`))?.statusz.runtimeVersion).toBe(
      '0.1.4',
    )
    version = undefined
    expect(
      (await fetchStatusz(`ws://localhost:${server.port}/acp`))?.statusz.runtimeVersion,
    ).toBeUndefined()
  } finally {
    await server.stop(true)
  }
})
