// A WebM of VP8 frames the helper page encoded, each at the time it was shown: the video's clock is
// theirs, not when the helper got to encode them.

/** One encoded frame: milliseconds since record_start, whether it is a key frame, its VP8 bytes. */
export type Chunk = { ms: number; key: boolean; data: Buffer }

const uint = (n: number) => {
  const bytes: number[] = []

  do {
    bytes.unshift(n % 256)
    n = Math.floor(n / 256)
  } while (n > 0)

  return Buffer.from(bytes)
}
/** An EBML element: its id, its size as an 8-byte length, then its body. */
const el = (id: number, ...body: (Buffer | string | number)[]) => {
  const data = Buffer.concat(
    body.map((b) => (typeof b === 'number' ? uint(b) : typeof b === 'string' ? Buffer.from(b) : b)),
  )
  const size = Buffer.alloc(8)

  size.writeBigUInt64BE(BigInt(data.length) | (1n << 56n))

  return Buffer.concat([uint(id), size, data])
}
const fixed = (n: number) => {
  const bytes = Buffer.alloc(4)

  bytes.writeUInt32BE(n)

  return bytes
}
const float = (n: number) => {
  const bytes = Buffer.alloc(8)

  bytes.writeDoubleBE(n)

  return bytes
}

/** The WebM of `chunks`, `ms` long: a cluster starts at every key frame. */
export function webm(chunks: Chunk[], size: { width: number; height: number }, ms: number) {
  const clusters: { at: number; blocks: Buffer[] }[] = []
  let start = 0

  for (const chunk of chunks) {
    const at = Math.round(chunk.ms)

    // A block's time is relative to its cluster's, in 16 bits.
    if (chunk.key || !clusters.length || at - start > 30_000) {
      start = at
      clusters.push({ at, blocks: [el(0xe7, at)] })
    }
    const block = Buffer.from([0x81, 0, 0, chunk.key ? 0x80 : 0])

    block.writeInt16BE(at - start, 1)
    clusters.at(-1)?.blocks.push(el(0xa3, block, chunk.data))
  }

  const info = el(
    0x1549a966,
    el(0x2ad7b1, 1_000_000),
    el(0x4d80, 'Nuphos'),
    el(0x5741, 'Nuphos'),
    el(0x4489, float(ms)),
  )
  const tracks = el(
    0x1654ae6b,
    el(
      0xae,
      el(0xd7, 1),
      el(0x73c5, 1),
      el(0x83, 1),
      el(0x86, 'V_VP8'),
      el(0xe0, el(0xb0, size.width), el(0xba, size.height)),
    ),
  )
  const bodies = clusters.map(({ blocks }) => el(0x1f43b675, ...blocks))
  // Cues say where each cluster starts, or a player cannot seek: they come before the clusters,
  // with positions of a fixed width so their own size is known before the positions are.
  const cues = (at: number[]) =>
    el(
      0x1c53bb6b,
      ...clusters.map((cluster, i) =>
        el(0xbb, el(0xb3, cluster.at), el(0xb7, el(0xf7, 1), el(0xf1, fixed(at[i])))),
      ),
    )
  let offset = info.length + tracks.length + cues(clusters.map(() => 0)).length
  const positions = bodies.map((body) => {
    const at = offset

    offset += body.length

    return at
  })

  return Buffer.concat([
    el(0x1a45dfa3, el(0x4286, 1), el(0x42f7, 1), el(0x42f2, 4), el(0x42f3, 8), el(0x4282, 'webm')),
    el(0x18538067, info, tracks, cues(positions), ...bodies),
  ])
}
