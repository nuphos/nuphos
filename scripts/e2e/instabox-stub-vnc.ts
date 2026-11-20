// A machine's desktop as instabox serves it on GET /v1/machines/{id}/vnc: RFB in a
// WebSocket, here colour bars in raw encoding, and only for the stub's own key.
import { createHash } from 'node:crypto'

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const WIDTH = 1280
const HEIGHT = 800
/** The colours of the bars, as noVNC asks for them: R, G, B, unused. */
const BARS = [
  [255, 255, 255],
  [255, 255, 0],
  [0, 255, 255],
  [0, 255, 0],
  [255, 0, 255],
  [255, 0, 0],
  [0, 0, 255],
  [0, 0, 0],
]

function frame(payload: Buffer): Buffer {
  const length = payload.length
  const head =
    length < 126
      ? Buffer.from([0x82, length])
      : length < 65_536
        ? Buffer.from([0x82, 126, length >> 8, length & 255])
        : Buffer.concat([Buffer.from([0x82, 127]), Buffer.alloc(8)])

  if (length >= 65_536) head.writeBigUInt64BE(BigInt(length), 2)

  return Buffer.concat([head, payload])
}

function picture(): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4)

  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = BARS[Math.floor((x * BARS.length) / WIDTH)]!
      const at = (y * WIDTH + x) * 4

      pixels[at] = r!
      pixels[at + 1] = g!
      pixels[at + 2] = b!
    }

  return Buffer.concat([
    // FramebufferUpdate: one raw rectangle covering the screen.
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, WIDTH >> 8, WIDTH & 255, HEIGHT >> 8, HEIGHT & 255]),
    Buffer.from([0, 0, 0, 0]),
    pixels,
  ])
}

/** The viewer's masked frames, unmasked; whatever arrives is answered by the RFB state. */
function readFrames(buffer: Buffer): { payloads: Buffer[]; rest: Buffer } {
  const payloads: Buffer[] = []
  let at = 0

  while (buffer.length - at >= 6) {
    let length = buffer[at + 1]! & 127
    let offset = at + 2

    if (length === 126) {
      length = buffer.readUInt16BE(offset)
      offset += 2
    } else if (length === 127) {
      length = Number(buffer.readBigUInt64BE(offset))
      offset += 8
    }
    if (buffer.length < offset + 4 + length) break
    const mask = buffer.subarray(offset, offset + 4)
    const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length))

    for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!
    if ((buffer[at]! & 15) === 2) payloads.push(payload)
    at = offset + 4 + length
  }

  return { payloads, rest: buffer.subarray(at) }
}

export function serveVnc(request: IncomingMessage, socket: Duplex, apiKey: string): void {
  if (request.headers['x-api-key'] !== apiKey) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')

    return
  }
  // RFC 6455's handshake is SHA-1 by definition; nothing secret is hashed.
  // eslint-disable-next-line sonarjs/hashing
  const accept = createHash('sha1')
    .update(`${String(request.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')

  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.write(frame(Buffer.from('RFB 003.008\n')))
  // version → security type → ClientInit → requests; each step waits for the viewer.
  let step = 0
  let pending = Buffer.alloc(0)

  socket.on('data', (chunk: Buffer) => {
    const { payloads, rest } = readFrames(Buffer.concat([pending, chunk]))

    pending = rest
    for (const payload of payloads) {
      if (step === 0) {
        socket.write(frame(Buffer.from([1, 1]))) // one security type: None
        step = 1
      } else if (step === 1) {
        socket.write(frame(Buffer.from([0, 0, 0, 0]))) // SecurityResult: OK
        step = 2
      } else if (step === 2) {
        const name = Buffer.from('e2e box')
        const init = Buffer.alloc(24)

        init.writeUInt16BE(WIDTH, 0)
        init.writeUInt16BE(HEIGHT, 2)
        // 32 bpp, depth 24, little-endian, true colour, R/G/B max 255 at shifts 0/8/16.
        Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 0, 8, 16, 0, 0, 0]).copy(init, 4)
        init.writeUInt32BE(name.length, 20)
        socket.write(frame(Buffer.concat([init, name])))
        step = 3
      } else if (payload[0] === 3) socket.write(frame(picture())) // FramebufferUpdateRequest
    }
  })
  socket.on('error', () => socket.destroy())
}
