import { strFromU8, unzipSync } from 'fflate'

import { XLSX_MAX_BYTES } from './xlsxLimits.ts'

const MAX_XML_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const PART =
  /^(?:\[Content_Types\]\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml))$/

/** Runs in a disposable worker: never extract attachments, macros or external parts. */
export function unpackXlsx(bytes: Uint8Array): Record<string, string> {
  if (!bytes.length || bytes.length > XLSX_MAX_BYTES) throw new Error('XLSX size limit')
  let entries = 0
  let total = 0
  const names = new Set<string>()
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (++entries > 256 || names.has(file.name)) throw new Error('XLSX entry limit')
      names.add(file.name)
      if (!PART.test(file.name)) return false
      if (
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !Number.isSafeInteger(file.originalSize) ||
        file.originalSize < 0 ||
        (file.compression !== 0 && file.compression !== 8)
      )
        throw new Error('XLSX invalid ZIP entry')
      // Stored entries copy size bytes, even if originalSize lies. Account for
      // every entry separately: overlapping offsets can duplicate the same data.
      const allocation = Math.max(file.size, file.originalSize)

      total += allocation
      if (allocation > MAX_XML_BYTES || total > MAX_TOTAL_BYTES)
        throw new Error('XLSX expansion limit')

      return true
    },
  })

  return Object.fromEntries(
    Object.entries(files).map(([name, data]) => {
      if (data.length > MAX_XML_BYTES) throw new Error('XLSX XML limit')

      return [name, strFromU8(data)]
    }),
  )
}
