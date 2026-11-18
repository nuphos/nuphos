// Splits an Annex B stream into access units (each ends at a slice) and writes them as the
// Mac host's rects carry them: x, y, w, h, flags, length, bytes (all big-endian).
import { readFileSync, writeFileSync } from 'node:fs'
const [input, output, w, h] = process.argv.slice(2)
const b = readFileSync(input)
const starts = []
for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0 && b[i + 3] === 1) starts.push(i)
const units = []
let from = 0
starts.forEach((s, k) => { const type = b[s + 4] & 0x1f; if (type === 1 || type === 5) { units.push(b.subarray(from, starts[k + 1] ?? b.length)); from = starts[k + 1] ?? b.length } })
const out = []
for (const u of units) { const head = Buffer.alloc(16); head.writeUInt16BE(0, 0); head.writeUInt16BE(0, 2); head.writeUInt16BE(+w, 4); head.writeUInt16BE(+h, 6); head.writeUInt32BE(0, 8); head.writeUInt32BE(u.length, 12); out.push(head, u) }
writeFileSync(output, Buffer.concat(out))
console.log(`packed ${units.length} frames`)
