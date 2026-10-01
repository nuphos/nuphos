export type ComplianceRow = {
  key: string
  name: string
  category: string
  reason: string
  remediation: string
  status: string
  lastRun: string | null
}

// Secureframe/Vanta return failure & remediation copy as HTML (e.g.
// `detailed_remediation_steps`). Rendering it as raw text shows literal tags,
// and injecting it as HTML would be an XSS risk, so we flatten it to readable
// plain text with the browser's own parser: block tags → newlines, list items
// → bullets, and links → "text (url)" so URLs aren't lost.
function trimTrailingSpacesAndTabs(line: string): string {
  let end = line.length

  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--

  return line.slice(0, end)
}

export function htmlToText(input: string | null | undefined): string {
  if (!input) return ''
  // No markup or entities — nothing to convert.
  if (!/[<&]/.test(input)) return input
  if (typeof DOMParser === 'undefined') return input
  const doc = new DOMParser().parseFromString(input, 'text/html')

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    const text = a.textContent ?? ''

    if (href && !text.includes(href)) a.textContent = text ? `${text} (${href})` : href
  })
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll('li').forEach((li) => li.insertAdjacentText('afterbegin', '• '))
  doc
    .querySelectorAll('p, li, div, tr, ul, ol, h1, h2, h3, h4, h5, h6')
    .forEach((el) => el.insertAdjacentText('beforeend', '\n'))

  return (doc.body.textContent ?? '')
    .split('\n')
    .map(trimTrailingSpacesAndTabs)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
