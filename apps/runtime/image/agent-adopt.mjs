// Preloaded (`node --import`) into an agent the shim keeps warm for the next session.
// The session's env and cwd arrive later as one JSON line on fd 3: this applies them
// to the running agent in place of a restart, then answers so the shim can go on.
import net from 'node:net'

if (process.env.NUPHOS_ADOPT_FD === '3') {
  delete process.env.NUPHOS_ADOPT_FD
  delete process.env.NODE_OPTIONS
  const channel = new net.Socket({ fd: 3, readable: true, writable: true })
  channel.unref()
  channel.on('error', () => {})
  let buffer = ''
  channel.on('data', (chunk) => {
    buffer += chunk
    const end = buffer.indexOf('\n')
    if (end < 0) return
    // Without the answer the shim restarts the agent under the session's env instead.
    try {
      const { env, cwd } = JSON.parse(buffer.slice(0, end))
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
      Object.assign(process.env, env)
      if (cwd) process.chdir(cwd)
      channel.end('ok\n')
    } catch {
      channel.destroy()
    }
  })
}
