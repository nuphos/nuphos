// The connect script carries the promises Nuphos makes to a customer's
// security review. They are one careless edit away from silently going away,
// and nothing else in CI would notice, so pin them here.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const scriptsDir = path.join(getBuiltinSkillsDirectory(), 'tailnet-ssh', 'scripts')
const connect = readFileSync(path.join(scriptsDir, 'connect.sh'), 'utf8')

describe('tailnet-ssh connect.sh', () => {
  test('joins with inbound connections refused', () => {
    expect(connect).toContain('--shields-up')
  })

  test('runs without a TUN device so a plain sandbox pod can host it', () => {
    expect(connect).toContain('--tun=userspace-networking')
  })

  test('keeps no node identity on disk', () => {
    expect(connect).toContain('--state=mem:')
  })

  test('detaches the daemon so it survives the exec that started it', () => {
    expect(connect).toMatch(/setsid\s+nohup\s+tailscaled/)
  })

  test('consumes the auth key from a file and deletes it', () => {
    expect(connect).toContain('--auth-key="file:${keyfile}"')
    expect(connect).toContain('rm -f "$keyfile"')
  })

  // The session env file is sourced into the agent's shell; an auth key in it
  // would outlive the join and be readable by every later command.
  test('never writes the auth key into the sourced env file', () => {
    const envBlock = connect.slice(connect.indexOf('session.env'))

    expect(envBlock).not.toContain('NUPHOS_TAILNET_AUTH_KEY')
    expect(envBlock).not.toMatch(/export\s+\w*AUTH_KEY/)
  })

  // `Host 100.*` would also capture unrelated 100.0.0.0/8 addressing and route
  // it through this node's bridge; Tailscale only owns 100.64.0.0/10.
  test('scopes the ssh ProxyCommand to the tailnet CGNAT range', () => {
    expect(connect).toContain('seq 64 127')
    expect(connect).not.toContain('Host 100.* ')
    expect(connect).toContain('*.ts.net')
  })

  // A block left behind after disconnect points every later tailnet ssh at a
  // ProxyCommand whose socket is gone.
  test('delimits the ssh config block so disconnect can remove exactly it', () => {
    const disconnect = readFileSync(path.join(scriptsDir, 'disconnect.sh'), 'utf8')

    expect(connect).toContain('SSH_CONFIG_MARKER=')
    expect(connect).toContain('SSH_CONFIG_END=')
    expect(disconnect).toContain('>>> nuphos-tailnet-ssh >>>')
    expect(disconnect).toContain('<<< nuphos-tailnet-ssh <<<')
  })
})
