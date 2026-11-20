import { createWriteStream, promises as fs } from 'node:fs'

import { ZipArchive } from 'archiver'

export type ZipEntry = { name: string; content: string | Buffer }

let sequence = 0

/** Writes `entries` to a zip at `destination`; a failed write leaves no partial file behind. */
export async function writeZipFile(destination: string, entries: ZipEntry[]): Promise<void> {
  const temp = `${destination}.part-${String(Date.now())}-${String(sequence++)}`

  try {
    const output = createWriteStream(temp)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const done = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
    })

    archive.pipe(output)
    for (const entry of entries) archive.append(entry.content, { name: entry.name })
    await archive.finalize()
    await done
    await fs.rename(temp, destination)
  } catch (error) {
    await fs.unlink(temp).catch(() => {})
    throw error
  }
}
