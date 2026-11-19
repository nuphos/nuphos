// Speaks mac-screen-host.swift's protocol with fixed colour bars and exits a minute after its
// last viewer, logging starts, viewers and input to NUPHOS_E2E_MAC_SCREEN_LOG. With
// NUPHOS_E2E_MAC_SCREEN_BLANK it never sends a picture, like frames the viewer cannot decode.
import { appendFileSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'

const [socketPath] = process.argv.slice(2)
const IDLE_MS = 60_000
const blank = Boolean(process.env.NUPHOS_E2E_MAC_SCREEN_BLANK)
const log = (line) => {
  if (process.env.NUPHOS_E2E_MAC_SCREEN_LOG)
    appendFileSync(process.env.NUPHOS_E2E_MAC_SCREEN_LOG, `${String(process.pid)} ${line}\n`)
}
const fixture = readFileSync(new URL('./fixtures/mac-screen-bars.bin', import.meta.url))
const frames = []

for (let at = 0; at < fixture.length;) {
  const length = fixture.readUInt32BE(at + 12)

  frames.push(fixture.subarray(at + 16, at + 16 + length))
  at += 16 + length
}
const width = fixture.readUInt16BE(4)
const height = fixture.readUInt16BE(6)
const be16 = (v) => [(v >> 8) & 255, v & 255]
const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
/** The host's FramebufferUpdate: one H.264 rect (encoding 50) with its length and flags. */
const update = (frame) =>
  Buffer.concat([
    Buffer.from([0, 0, ...be16(1), ...be16(0), ...be16(0), ...be16(width), ...be16(height)]),
    Buffer.from([...be32(50), ...be32(frame.length), ...be32(0)]),
    frame,
  ])

let viewers = 0
let idle
const countViewers = (change) => {
  viewers += change
  clearTimeout(idle)
  if (viewers === 0)
    idle = setTimeout(() => {
      log('exit idle')
      process.exit(0)
    }, IDLE_MS)
}

/** Bytes of the client message at the head of `b`, Infinity while incomplete, null when unknown. */
function size(b) {
  switch (b[0]) {
    case 0:
      return 20
    case 2:
      return b.length < 4 ? Infinity : 4 + 4 * b.readUInt16BE(2)
    case 3:
      return 10
    case 4:
      return 8
    case 5:
      return 6
    case 6:
      return b.length < 8 ? Infinity : 8 + b.readUInt32BE(4)
    case 251:
      return b.length < 8 ? Infinity : 8 + 16 * b[6]
    default:
      return null
  }
}

const server = createServer((socket) => {
  countViewers(1)
  log('viewer')
  let phase = 'version'
  let pending = Buffer.alloc(0)
  // The next delta to send for an incremental request; a still screen sends nothing more.
  let next = frames.length

  socket.write('RFB 003.008\n')
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk])
    for (;;) {
      const need =
        phase === 'version'
          ? 12
          : phase === 'messages'
            ? pending.length
              ? size(pending)
              : Infinity
            : 1

      if (need === null) return socket.destroy()
      if (pending.length < need) return
      const message = pending.subarray(0, need)

      pending = pending.subarray(need)
      if (phase === 'version') {
        phase = 'security'
        socket.write(Buffer.from([1, 1]))
      } else if (phase === 'security') {
        phase = 'init'
        socket.write(Buffer.from(be32(0)))
      } else if (phase === 'init') {
        phase = 'messages'
        const name = Buffer.from('Nuphos Mac')

        socket.write(
          Buffer.from([
            ...be16(width),
            ...be16(height),
            32,
            24,
            0,
            1,
            0,
            255,
            0,
            255,
            0,
            255,
            16,
            8,
            0,
            0,
            0,
            0,
            ...be32(name.length),
            ...name,
          ]),
        )
      } else if (message[0] === 3 && !blank) {
        // Full: the keyframe, then the deltas on the incremental requests that follow it.
        if (message[1] === 0) {
          socket.write(update(frames[0]))
          next = 1
        } else if (next < frames.length) socket.write(update(frames[next++]))
      } else if (message[0] === 5)
        log(
          `pointer ${String(message[1])} ${String(message.readUInt16BE(2))} ${String(message.readUInt16BE(4))}`,
        )
      else if (message[0] === 4)
        log(`key ${message[1] ? 'down' : 'up'} ${String(message.readUInt32BE(4))}`)
    }
  })
  socket.on('close', () => {
    log('viewer left')
    countViewers(-1)
  })
  socket.on('error', () => {})
})

rmSync(socketPath, { force: true })
server.listen(socketPath, () => {
  log('listening')
  console.log(`listening on ${socketPath}`)
  countViewers(0)
})
