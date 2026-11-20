// #3354: a computer that reaches the backend only through a proxy, as behind a VPN or proxy
// app. Before #3348 the window followed the system proxy and the runtime tunnel did not, so
// the app looked fine while its computer kept dropping offline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { backendLog } from './backend-log.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, until } from './processes.ts'
import { PROXIED_HOST, startProxies } from './proxy.ts'

import type { Proxies } from './proxy.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

/** Longer than the 12 s idle timeout and four 5 s heartbeats: a tunnel left idle stays up. */
const IDLE_MS = 20_000

/** The system proxy as Chromium reads it on Linux without a desktop environment. */
const SYSTEM_PROXY: Record<string, (proxies: Proxies) => Record<string, string>> = {
  http: (p) => ({
    http_proxy: `http://127.0.0.1:${String(p.http)}`,
    https_proxy: `http://127.0.0.1:${String(p.http)}`,
  }),
  // Its first proxy is down: the tunnel moves on to the next one (#3400).
  pac: (p) => ({ auto_proxy: p.pacUrl }),
  // Chromium reads `all_proxy=socks5://…` as an HTTP proxy; SOCKS_SERVER keeps it SOCKS5.
  socks: (p) => ({ SOCKS_SERVER: `127.0.0.1:${String(p.socks)}`, SOCKS_VERSION: '5' }),
}

const tunnelLines = (deviceId: string) =>
  backendLog().filter(
    (line) => line.includes(`"device_id":"${deviceId}"`) && /tunnel_(opened|closed)/.test(line),
  )

async function proxiedComputer(stack: Stack, proxies: Proxies, kind: keyof typeof SYSTEM_PROXY) {
  const port = new URL(stack.apiUrl).port
  const api = `http://${PROXIED_HOST}:${port}`
  const name = `desktop-${kind}-proxy`
  const me = (await (
    await fetch(`${stack.apiUrl}/auth/me`, { headers: { authorization: `Bearer ${stack.token}` } })
  ).json()) as { id: string }

  const signIn = join(artifacts, `sign-in-${name}`)

  mkdirSync(signIn, { recursive: true })
  // Signed in as the suite's own account, for the backend this app reaches by the proxied name.
  writeFileSync(
    join(signIn, 'desktop.yaml'),
    `api: ${api}\ntoken: ${stack.token}\nuserInfo:\n  id: ${me.id}\n`,
    { mode: 0o600 },
  )
  const desktop = await startDesktop(api, {
    name,
    // The Vite dev server is on this computer; Chromium never proxies loopback anyway.
    env: { ...SYSTEM_PROXY[kind]!(proxies), no_proxy: 'localhost,127.0.0.1' },
  })
  let deviceId = ''

  try {
    await until(`the ${kind}-proxied app to know its computer`, async () => {
      deviceId = JSON.parse(readFileSync(join(desktop.profile, 'device-identity.json'), 'utf8'))
        .deviceId as string

      return deviceId
    })
    // `.invalid` never resolves, so the tunnel can only have opened through the proxy.
    await until(
      `the ${kind}-proxied computer's tunnel to open`,
      async () => tunnelLines(deviceId).some((line) => line.includes('tunnel_opened')),
      90_000,
    )
    const opened = tunnelLines(deviceId).length

    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
    const since = tunnelLines(deviceId).slice(opened)

    await desktop.page.screenshot({ path: join(artifacts, `${name}.png`) })
    if (since.length > 0)
      throw new Error(`The ${kind}-proxied tunnel dropped while idle:\n${since.join('\n')}`)
  } finally {
    await desktop.stop()
  }
}

export const proxyScenarios: Scenario[] = (['http', 'pac', 'socks'] as const).map((kind) => ({
  name: `a computer behind a ${kind === 'pac' ? 'PAC' : kind.toUpperCase()} system proxy keeps its tunnel through it, idle included`,
  run: async (_page, stack) => {
    const proxies = await startProxies()

    try {
      await proxiedComputer(stack, proxies, kind)
      const through = kind === 'socks' ? proxies.tunnels.socks : proxies.tunnels.http
      const backend = `${PROXIED_HOST}:${new URL(stack.apiUrl).port}`

      if (!through.includes(backend))
        throw new Error(
          `The ${kind} proxy never tunneled to the backend: ${JSON.stringify(through)}`,
        )
    } finally {
      proxies.close()
    }
  },
}))
