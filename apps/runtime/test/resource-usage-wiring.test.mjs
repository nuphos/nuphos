import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const dockerfile = readFileSync(new URL('../image/Dockerfile', import.meta.url), 'utf8')

test('OpenAB reports disk usage for the home and workspace volumes', () => {
  assert.match(dockerfile, /^ENV OPENAB_RUNTIME_DISK_PATHS=\/home\/node,\/workspace$/mu)
})
