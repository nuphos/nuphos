import { afterAll, describe, expect, test } from 'bun:test'

const requests: Array<{ url: string; authorization: string | null }> = []
const server = Bun.serve({
  port: 0,
  fetch(request) {
    requests.push({
      url: request.url,
      authorization: request.headers.get('authorization'),
    })

    return Response.json({ ok: true })
  },
})

afterAll(() => server.stop(true))

function tokenFor(origin: string): string {
  const payload = Buffer.from(JSON.stringify({ ori: origin })).toString('base64url')

  // The helper only reads the signed claim. The backend verifies the signature
  // when it receives the request; this local server intentionally does not.
  return `header.${payload}.signature`
}

async function run(path: string, env: Record<string, string> = {}) {
  const process = Bun.spawn(['bash', import.meta.dir + '/nuphos-api.sh', 'GET', path], {
    env: {
      ...Bun.env,
      NUPHOS_TOKEN: tokenFor(server.url.origin),
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    exitCode: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  }
}

describe('nuphos-api helper origin binding', () => {
  test('uses the origin signed into the token and ignores an env override', async () => {
    const result = await run('/safe', { NUPHOS_BACKEND_URL: 'https://attacker.invalid' })

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toEqual({ ok: true })
    expect(requests.at(-1)?.url).toBe(`${server.url.origin}/safe`)
    expect(requests.at(-1)?.authorization).toStartWith('Bearer header.')
  })

  test('rejects control characters in the path before making a request', async () => {
    const count = requests.length
    const result = await run('/safe\nurl = "https://attacker.invalid"')

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('must not contain control characters')
    expect(requests).toHaveLength(count)
  })
})
