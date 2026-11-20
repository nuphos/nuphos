import { buildComplianceExportFiles } from './complianceExport/build.ts'
import { writeZipFile } from './zip-file.ts'

import type { AgentComplianceExportBundle } from './agent.ts'

export { buildComplianceExportFiles }
export type { ComplianceExportFile } from './complianceExport/build.ts'

export async function writeComplianceExportZip(
  bundle: AgentComplianceExportBundle,
  destination: string,
): Promise<{ fileCount: number }> {
  const files = buildComplianceExportFiles(bundle)

  await writeZipFile(destination, files)

  return { fileCount: files.length }
}
