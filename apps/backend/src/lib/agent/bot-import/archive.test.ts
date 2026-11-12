import { describe, expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'

import { readBotBundle } from './archive'
import { botBundleSchema, bundlePath } from './manifest'

const manifest = () => ({
  format: 'nuphos-bot-bundle',
  version: 1,
  source: { application: 'grok-bot', exportedAt: '2026-11-11T00:00:00Z' },
  bots: [{ key: 'research', name: 'Research', instructions: 'Write cited briefs.' }],
  chats: [{ key: 'desk', name: 'Desk', members: ['research'], lead: 'research' }],
})

// A stored ZIP fixture writer, independent of the reader; also permits deliberately malformed headers.
function zip(
  files: [string, string][],
  options: { mode?: number; flags?: number; deflate?: boolean } = {},
) {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const [path, text] of files) {
    const name = Buffer.from(path)
    const data = Buffer.from(text)
    let crc = -1

    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    crc = (crc ^ -1) >>> 0
    const compressed = options.deflate ? deflateRawSync(data) : data
    const header = Buffer.alloc(30)

    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(options.flags ?? 0x800, 6)
    header.writeUInt16LE(options.deflate ? 8 : 0, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    locals.push(header, name, compressed)
    const central = Buffer.alloc(46)

    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x314, 4)
    header.copy(central, 6, 4, 26)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((options.mode ?? 0x81a4) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += header.length + name.length + compressed.length
  }
  const entries = Buffer.concat(directory)
  const end = Buffer.alloc(22)

  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(entries.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, entries, end])
}

const bundle = (extra: [string, string][] = [], value: unknown = manifest()) =>
  zip([['manifest.json', JSON.stringify(value)], ...extra])

describe('independent Bot bundle admission', () => {
  test('reads a bundle without provider execution and keeps source references', async () => {
    const archive = await readBotBundle(bundle())

    expect(archive.manifest.bots[0]?.key).toBe('research')
    expect(archive.manifest.chats[0]?.lead).toBe('research')
    expect(archive.digest).toHaveLength(64)
    expect(archive.manifest.bots[0]?.schedules).toEqual([])
  })

  test('supports actual deflate content', async () => {
    expect(
      (await readBotBundle(zip([['manifest.json', JSON.stringify(manifest())]], { deflate: true })))
        .manifest.bots,
    ).toHaveLength(1)
  })

  test.each([
    '../escape',
    '/absolute',
    'C:/drive',
    'folder\\escape',
    'a/../b',
    '.env.local',
    'private-key.pem',
  ])('refuses unsafe path %s', async (path) => {
    expect(bundlePath(path)).toBe(false)
    await expect(readBotBundle(bundle([[path, 'unsafe']]))).rejects.toThrow()
  })

  test('rejects links, encrypted archives and normalized duplicate paths', async () => {
    const files: [string, string][] = [['manifest.json', JSON.stringify(manifest())]]

    await expect(readBotBundle(zip(files, { mode: 0xa1ff }))).rejects.toThrow('links')
    await expect(readBotBundle(zip(files, { flags: 1 }))).rejects.toThrow('encryption')
    expect(
      (await readBotBundle(zip(files, { flags: 0x802, deflate: true }))).manifest.bots,
    ).toHaveLength(1)
    await expect(readBotBundle(bundle([['Manifest.json', '{}']]))).rejects.toThrow('duplicate')
    await expect(
      readBotBundle(
        bundle([
          ['é.txt', 'a'],
          ['e\u0301.txt', 'b'],
        ]),
      ),
    ).rejects.toThrow('duplicate')
  })

  test('checks CRC and does not trust the local header name', async () => {
    const damaged = bundle()

    damaged[45] = damaged[45]! ^ 1
    await expect(readBotBundle(damaged)).rejects.toThrow('integrity')
    const mismatch = bundle()

    mismatch[30] = 88
    await expect(readBotBundle(mismatch)).rejects.toThrow('headers disagree')
  })

  test('rejects undeclared files and missing referenced files', async () => {
    await expect(
      readBotBundle(bundle([['notes.txt', 'do not silently carry me']])),
    ).rejects.toThrow('undeclared')
    const value = {
      ...manifest(),
      bots: [{ ...manifest().bots[0], files: [{ path: 'files/plan.md', destination: 'plan.md' }] }],
    }

    await expect(readBotBundle(bundle([], value))).rejects.toThrow('missing file')
    expect(
      (await readBotBundle(bundle([['files/plan.md', '# Plan']], value))).files.has(
        'files/plan.md',
      ),
    ).toBe(true)
  })

  test('detects fake secrets in parsed fields despite JSON escapes and in file contents', async () => {
    const fake = `ghp_${'a'.repeat(30)}`
    const escaped = JSON.stringify(manifest()).replace(
      'Write cited briefs.',
      fake.replace('g', '\\u0067'),
    )

    await expect(readBotBundle(zip([['manifest.json', escaped]]))).rejects.toThrow('secret-bearing')
    const value = {
      ...manifest(),
      bots: [
        { ...manifest().bots[0], files: [{ path: 'files/notes.md', destination: 'notes.md' }] },
      ],
    }

    await expect(readBotBundle(bundle([['files/notes.md', fake]], value))).rejects.toThrow(
      'secret-bearing',
    )
    const withComment = bundle([])
    const comment = Buffer.from(fake)

    withComment.writeUInt16LE(comment.length, withComment.length - 2)
    await expect(readBotBundle(Buffer.concat([withComment, comment]))).rejects.toThrow(
      'secret-bearing',
    )
  })

  test('accepts ordinary prose, code and links that only resemble secrets', async () => {
    for (const text of [
      'GitHub token: reconnect in Nuphos.',
      'Credentials: reconnect in Nuphos settings.',
      'Use the type `password: string` in the form model.',
      'See https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    ]) {
      const value = { ...manifest(), bots: [{ ...manifest().bots[0], instructions: text }] }

      expect(
        (await readBotBundle(zip([['manifest.json', JSON.stringify(value)]]))).manifest.bots,
      ).toHaveLength(1)
    }
  })

  test('still refuses a keyed credential in instructions and workspace files', async () => {
    const key = `OPENAI_API_KEY=sk-proj-${'a1B2'.repeat(8)}`
    const inline = { ...manifest(), bots: [{ ...manifest().bots[0], instructions: key }] }

    await expect(readBotBundle(zip([['manifest.json', JSON.stringify(inline)]]))).rejects.toThrow(
      'secret-bearing',
    )
    const value = {
      ...manifest(),
      bots: [{ ...manifest().bots[0], files: [{ path: 'files/run.sh', destination: 'run.sh' }] }],
    }

    await expect(
      readBotBundle(bundle([['files/run.sh', `deploy --token ${'x9Y8'.repeat(6)}`]], value)),
    ).rejects.toThrow('secret-bearing')
  })

  test('rejects highly expanding ZIP data before inflation', async () => {
    await expect(
      readBotBundle(zip([['manifest.json', 'a'.repeat(100_000)]], { deflate: true })),
    ).rejects.toThrow('ratio')
  })

  test('validates keys, chat membership, versions and schedule timezones', async () => {
    expect(botBundleSchema.safeParse({ ...manifest(), version: 2 }).success).toBe(false)
    expect(
      botBundleSchema.safeParse({ ...manifest(), bots: [...manifest().bots, ...manifest().bots] })
        .success,
    ).toBe(false)
    expect(
      botBundleSchema.safeParse({
        ...manifest(),
        chats: [{ key: 'desk', name: 'Desk', members: ['missing'] }],
      }).success,
    ).toBe(false)
    const schedules = [
      {
        key: 'daily',
        name: 'Daily',
        prompt: 'Brief',
        timeZone: 'Invalid/Zone',
        schedule: { kind: 'cron', expression: '0 9 * * *' },
      },
    ]

    expect(
      botBundleSchema.safeParse({ ...manifest(), bots: [{ ...manifest().bots[0], schedules }] })
        .success,
    ).toBe(false)
  })
})
