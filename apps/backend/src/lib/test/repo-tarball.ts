import { gzipSync } from 'node:zlib'

export type TarEntry = { path: string; content?: string; type?: '0' | '2' | '5'; link?: string }

function header(path: string, size: number, type: string, link = ''): Buffer {
  const block = Buffer.alloc(512)

  block.write(path.slice(0, 100), 0)
  block.write('0000644\0', 100)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write('00000000000\0', 136)
  block.write(type, 156)
  block.write(link, 157)
  block.write('ustar\x0000', 257)
  block.write('        ', 148)
  let sum = 0

  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)

  return block
}

function entry(path: string, data: Buffer, type: string, link?: string): Buffer[] {
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)

  return [header(path, data.length, type, link), data, pad]
}

function pax(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`
  let length = body.length + 1

  while (String(length).length + body.length !== length) length++

  return Buffer.from(`${String(length)}${body}`)
}

/** Builds a gzip tarball shaped like `git archive` output from codeload.github.com. */
export function repoTarball(
  entries: TarEntry[],
  options: { commitSha?: string; root?: string } = {},
): Uint8Array {
  const root = options.root ?? 'repo-main'
  const blocks: Buffer[] = []

  if (options.commitSha !== undefined)
    blocks.push(...entry('pax_global_header', pax('comment', options.commitSha), 'g'))
  blocks.push(...entry(`${root}/`, Buffer.alloc(0), '5'))
  for (const item of entries) {
    const path =
      item.path.startsWith('/') || item.path.startsWith('..') ? item.path : `${root}/${item.path}`
    const data = Buffer.from(item.content ?? '')

    if (path.length > 100) blocks.push(...entry('././@PaxHeader', pax('path', path), 'x'))
    blocks.push(...entry(path, data, item.type ?? '0', item.link))
  }
  blocks.push(Buffer.alloc(1024))

  return gzipSync(Buffer.concat(blocks))
}
