// trycloudflare tunnels for local ports. Remote Boxes PUT/GET presigned URLs
// straight at rustfs, so in dev it needs a public URL of its own.
import { spawn } from 'node:child_process'

import { signalGroup } from './dev-shutdown.ts'

import type { ChildProcess } from 'node:child_process'

type QuickTunnel = { proc: ChildProcess; url: string | null }

// Resolves with the tunnel URL, or null after 20 s.
export async function spawnQuickTunnel(port: number): Promise<QuickTunnel> {
  // An empty --config: a named tunnel's config.yml would route this one to its 404 catch-all.
  const args = ['tunnel', '--config', '/dev/null', '--url', `http://localhost:${port}`]
  const proc = spawn('cloudflared', [...args, '--no-autoupdate', '--no-prechecks'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise<string | null>((resolve) => {
    const onData = (chunk: Buffer) => {
      const m = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)

      if (m) resolve(m[0])
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    setTimeout(() => resolve(null), 20_000)
  })

  return { proc, url }
}

let storage: QuickTunnel | null = null

// Kept across backend restarts; replaced only once its process is gone.
export async function storageTunnelUrl(port: number): Promise<string | null> {
  if (storage && storage.proc.exitCode === null && storage.proc.signalCode === null) {
    return storage.url
  }
  if (!Bun.which('cloudflared')) return null
  storage = await spawnQuickTunnel(port)

  return storage.url
}

export function stopStorageTunnel() {
  signalGroup(storage?.proc ?? null, 'SIGTERM')
  storage = null
}
