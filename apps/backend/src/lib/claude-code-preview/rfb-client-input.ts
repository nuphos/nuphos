// Client-to-server RFB, framed on the stream itself so the viewer's input can be
// dropped until they hold the desktop, whatever their client does. The
// handshake (version, security type, ClientInit) passes; after it, every message
// is sized by its type, input messages are kept back unless allowed, and a type
// this does not know ends the stream rather than guessing its length.

const VERSION = /^RFB 003\.00[78]\n$/u
/** KeyEvent, PointerEvent, ClientCutText, xvp, SetDesktopSize, and QEMU's extended key event. */
const INPUT = new Set([4, 5, 6, 250, 251, 255])
/** A clipboard paste larger than this, or more unparsed bytes than this, ends the stream. */
const MAX_PENDING = 256 * 1024

/** Bytes of the message at the head of `bytes`: 0 while incomplete, null when unknown. */
function messageSize(bytes: Buffer): number | null {
  const type = bytes[0] ?? -1

  switch (type) {
    case 0:
      return 20 // SetPixelFormat
    case 2:
      return bytes.length < 4 ? 0 : 4 + 4 * bytes.readUInt16BE(2) // SetEncodings
    case 3:
    case 150:
      return 10 // FramebufferUpdateRequest, EnableContinuousUpdates
    case 4:
      return 8 // KeyEvent
    case 5:
      return bytes.length < 2 ? 0 : (bytes[1] ?? 0) & 0x80 ? 7 : 6 // PointerEvent; extended has a marker bit
    case 6: {
      if (bytes.length < 8) return 0
      const length = Math.abs(bytes.readInt32BE(4)) // ClientCutText (extended: negative)

      return length > MAX_PENDING ? null : 8 + length
    }
    case 248:
      return bytes.length < 9 ? 0 : 9 + (bytes[8] ?? 0) // ClientFence, answering the server's
    case 250:
      return 4 // xvp
    case 251:
      return bytes.length < 7 ? 0 : 8 + 16 * (bytes[6] ?? 0) // SetDesktopSize
    case 255:
      return bytes.length < 2 ? 0 : bytes[1] === 0 ? 12 : null // QEMU key event; audio is not ours
    default:
      return null
  }
}

export type ClientInputFilter = {
  /** The bytes to forward, or null when the client broke the protocol. */
  push(bytes: Buffer, allowInput: boolean): Buffer | null
}

export function clientInputFilter(): ClientInputFilter {
  let buffer = Buffer.alloc(0)
  let phase: 'version' | 'security' | 'init' | 'messages' = 'version'

  return {
    push(bytes, allowInput) {
      buffer = Buffer.concat([buffer, bytes])
      if (buffer.length > MAX_PENDING) return null
      const out: Buffer[] = []

      for (;;) {
        let size: number | null

        if (phase === 'version') size = buffer.length < 12 ? 0 : 12
        else if (phase === 'messages') size = buffer.length ? messageSize(buffer) : 0
        else size = buffer.length ? 1 : 0
        if (size === null) return null
        if (size === 0 || buffer.length < size) break
        const message = buffer.subarray(0, size)

        buffer = buffer.subarray(size)
        if (phase === 'version') {
          if (!VERSION.test(message.toString('latin1'))) return null
          phase = 'security'
        } else if (phase === 'security') phase = 'init'
        else if (phase === 'init') phase = 'messages'
        else if (INPUT.has(message[0] ?? -1) && !allowInput) continue
        out.push(message)
      }

      return Buffer.concat(out)
    },
  }
}
