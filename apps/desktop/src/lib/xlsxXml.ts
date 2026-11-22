export type XlsxSheet = { name: string; rows: string[][]; columns: number }
const MAX_ROWS = 2000
const MAX_COLUMNS = 100
const MAX_CELLS = 50000

function xml(source: string | undefined): Document {
  if (!source || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Invalid workbook XML')
  const doc = new DOMParser().parseFromString(source, 'application/xml')

  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid workbook XML')

  return doc
}
const elements = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagName('*')).filter((node) => node.localName === name)
const value = (root: Element, name: string) => elements(root, name)[0]?.textContent ?? ''

export function columnName(index: number): string {
  let name = ''

  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name

  return name
}

/** Saved cell values only. No formulas, links, styles or HTML are evaluated. */
export function parseXlsxParts(parts: Record<string, string>): XlsxSheet[] {
  const workbook = xml(parts['xl/workbook.xml'])
  const rels = elements(xml(parts['xl/_rels/workbook.xml.rels']), 'Relationship')
  const shared = parts['xl/sharedStrings.xml']
    ? elements(xml(parts['xl/sharedStrings.xml']), 'si').map((si) =>
        elements(si, 't')
          .map((t) => t.textContent ?? '')
          .join(''),
      )
    : []
  const sheets = elements(workbook, 'sheet')
  let count = 0

  if (!sheets.length || sheets.length > 20 || shared.length > MAX_CELLS)
    throw new Error('Workbook limit')

  return sheets.map((sheet) => {
    const id =
      sheet.getAttribute('r:id') ??
      sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      )
    const rel = rels.find((r) => r.getAttribute('Id') === id)
    const target = rel?.getAttribute('Target') ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`

    if (
      rel?.getAttribute('TargetMode') === 'External' ||
      !/^xl\/worksheets\/[^/]+\.xml$/.test(path)
    )
      throw new Error('Unsupported worksheet')
    const data = xml(parts[path])
    const rows: string[][] = []
    let columns = 0
    let nextRow = 0

    for (const row of elements(data, 'row')) {
      const rowIndex = row.hasAttribute('r') ? Number(row.getAttribute('r')) - 1 : nextRow

      if (!Number.isInteger(rowIndex) || rowIndex < nextRow || rowIndex >= MAX_ROWS)
        throw new Error('Worksheet row limit')
      nextRow = rowIndex + 1
      const cells: string[] = []
      let nextColumn = 0

      for (const cell of elements(row, 'c')) {
        if (++count > MAX_CELLS) throw new Error('Worksheet cell limit')
        const ref = cell.getAttribute('r')
        const match = ref?.match(/^([A-Z]+)([1-9]\d*)$/)
        let column = nextColumn

        if (ref) {
          if (!match || Number(match[2]) !== rowIndex + 1) throw new Error('Invalid cell address')
          column = Array.from(match[1]).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
        }
        if (column < nextColumn || column >= MAX_COLUMNS) throw new Error('Worksheet column limit')
        nextColumn = column + 1
        const type = cell.getAttribute('t')
        const stored = value(cell, 'v')
        const formula = value(cell, 'f')
        let text = stored

        if (type === 's') {
          const index = Number(stored)

          if (!/^\d+$/.test(stored) || !Number.isSafeInteger(index) || index >= shared.length)
            throw new Error('Invalid shared string')
          text = shared[index]
        } else if (type === 'inlineStr')
          text = elements(cell, 't')
            .map((t) => t.textContent ?? '')
            .join('')
        else if (type === 'b') text = stored === '1' ? 'TRUE' : 'FALSE'
        if (!stored && formula) text = `=${formula}`
        if (text.length > 32767) throw new Error('Cell text limit')
        cells[column] = text
        columns = Math.max(columns, nextColumn)
      }
      rows[rowIndex] = cells
    }

    return {
      name: sheet.getAttribute('name') || 'Sheet',
      rows: Array.from({ length: rows.length }, (_, i) => rows[i] ?? []),
      columns,
    }
  })
}
