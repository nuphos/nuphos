import { createWriteStream, promises as fs } from 'node:fs'

import { ZipArchive } from 'archiver'

import { buildComplianceExportFiles } from './complianceExport/build.ts'

import type { AgentComplianceExportBundle } from './agent.ts'

export { buildComplianceExportFiles }
export type { ComplianceExportFile } from './complianceExport/build.ts'

let exportSequence = 0

export async function writeComplianceExportZip(
  bundle: AgentComplianceExportBundle,
  destination: string,
): Promise<{ fileCount: number }> {
  const temp = `${destination}.part-${String(Date.now())}-${String(exportSequence++)}`

  try {
    const output = createWriteStream(temp)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const done = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
    })

    archive.pipe(output)
    const files = buildComplianceExportFiles(bundle)

    for (const file of files) archive.append(file.content, { name: file.name })
    await archive.finalize()
    await done
    await fs.rename(temp, destination)

    return { fileCount: files.length }
  } catch (error) {
    await fs.unlink(temp).catch(() => {})
    throw error
  }
}
