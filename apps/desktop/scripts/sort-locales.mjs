// Sorts every locale's keys. A new string then lands at its own place in the
// file instead of at the end, where every other PR also appends.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const dir = new URL('../src/i18n/locales/', import.meta.url)

for (const name of readdirSync(dir)) {
  const file = new URL(name, dir)
  const messages = JSON.parse(readFileSync(file, 'utf8'))
  const sorted = Object.fromEntries(
    Object.keys(messages)
      .sort()
      .map((key) => [key, messages[key]]),
  )
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`)
}
