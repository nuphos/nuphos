import { strToU8, zipSync } from 'fflate'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export function workbookParts() {
  return {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/><sheet name="Empty" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst xmlns="${ns}"><si><t>Item</t></si><si><r><t>Example </t></r><r><t>only</t></r></si><si><t>&lt;script&gt;globalThis.xlsxExecuted=true&lt;/script&gt;</t></si></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c><c r="C1" t="inlineStr"><is><t>Saved total</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>12</v></c><c r="C2"><f>B2*10</f><v>120</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Formula without saved value</t></is></c><c r="C3"><f>1+2</f></c></row><row r="5"><c r="A5" t="b"><v>1</v></c><c r="C5" t="e"><v>#N/A</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c></row>${Array.from({ length: 300 }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>Detail ${i + 1}</t></is></c><c r="B${i + 2}"><v>${i + 1}</v></c></row>`).join('')}</sheetData><hyperlinks><hyperlink ref="A1" location="https://example.invalid/external"/></hyperlinks></worksheet>`,
    'xl/worksheets/sheet3.xml': `<worksheet xmlns="${ns}"><sheetData/></worksheet>`,
    'xl/vbaProject.bin': 'NOT EXECUTABLE FIXTURE',
    'xl/externalLinks/externalLink1.xml':
      '<externalLink>https://example.invalid/never-fetch</externalLink>',
  }
}
export function zipParts(parts) {
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])),
  )
}
export function workbookBytes() {
  return zipParts(workbookParts())
}
