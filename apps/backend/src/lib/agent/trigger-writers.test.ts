import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test } from 'bun:test'
import ts from 'typescript'

import { TRIGGER_CONFIG } from './trigger-history'

// A Trigger is created, changed or deleted only inside writeTrigger, which
// records it (#3755). Any other such write would leave no trace.
const CONFIG = new Set<string>([
  ...TRIGGER_CONFIG,
  'configRevision',
  'webhookSecret',
  'userId',
  'teamId',
])
const UPDATES = new Set(['updateOne', 'updateMany', 'findOneAndUpdate'])
const OTHER_WRITES = new Set([
  'insertOne',
  'insertMany',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'bulkWrite',
])
const OPERATORS = new Set(['$set', '$unset', '$inc', '$rename', '$push', '$pull'])
const SRC = join(import.meta.dir, '../..')
// The Triggers collection, or one passed in for tests (`triggers`, `deps.triggers`).
const TRIGGERS = /agentTriggers\(\)$|(^|\.)triggers$/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path)

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

// Keys an object literal may write, through spreads like `...(x ? { a } : {})`;
// undefined when it is not a literal, so what it writes cannot be told.
function keys(node: ts.Node | undefined): { name: string; value?: ts.Node }[] | undefined {
  if (!node) return []
  if (ts.isParenthesizedExpression(node)) return keys(node.expression)
  if (ts.isConditionalExpression(node)) {
    const [whenTrue, whenFalse] = [keys(node.whenTrue), keys(node.whenFalse)]

    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined
  }
  if (ts.isBinaryExpression(node)) return keys(node.right)
  if (!ts.isObjectLiteralExpression(node)) return undefined
  const found: { name: string; value?: ts.Node }[] = []

  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = keys(property.expression)

      if (!spread) return undefined
      found.push(...spread)
    } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      found.push({
        name: property.name.getText().replace(/^['"]|['"]$/g, ''),
        value: ts.isPropertyAssignment(property) ? property.initializer : undefined,
      })
    }
  }

  return found
}

// What an update writes to a Trigger's configuration; undefined when it cannot be told.
function configWritten(update: ts.Node | undefined): string[] | undefined {
  const operators = keys(update)

  if (!operators) return undefined
  const written: string[] = []

  for (const { value } of operators.filter(({ name }) => OPERATORS.has(name))) {
    const fields = keys(value)

    if (!fields) return undefined
    written.push(...fields.map((field) => field.name).filter((field) => CONFIG.has(field)))
  }

  return written
}

// What a write does that only writeTrigger may, if anything.
function unrecorded(method: string, update: ts.Node | undefined): string | undefined {
  if (OTHER_WRITES.has(method)) return method
  if (!UPDATES.has(method)) return undefined
  const written = configWritten(update)

  if (!written) return `${method} of an update it cannot read`

  return written.length ? `${method} of ${written.join(', ')}` : undefined
}

const insideWriteTrigger = (node: ts.Node): boolean =>
  Boolean(node.parent) &&
  ((ts.isCallExpression(node.parent) && node.parent.expression.getText() === 'writeTrigger') ||
    insideWriteTrigger(node.parent))

function unrecordedTriggerWrites(file: string, text = readFileSync(file, 'utf8')) {
  if (!/agentTriggers|triggers\./.test(text)) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      TRIGGERS.test(node.expression.expression.getText()) &&
      !insideWriteTrigger(node)
    ) {
      const bad = unrecorded(node.expression.name.text, node.arguments[1])

      if (bad) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())

        found.push(`${relative(SRC, file)}:${String(line + 1)} ${bad}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)

  return found
}

test('only writeTrigger creates, changes or deletes a Trigger', () => {
  expect(sources(SRC).flatMap((file) => unrecordedTriggerWrites(file))).toEqual([])
})

test('the guard sees each kind of unrecorded write, and lets run state through', () => {
  const probe = (text: string) => unrecordedTriggerWrites(join(SRC, 'probe.ts'), text)

  expect(probe(`agentTriggers().deleteOne({ _id })`)).toEqual(['probe.ts:1 deleteOne'])
  expect(
    probe(`deps.triggers.updateOne({ _id }, { $set: { ...(x ? { enabled: false } : {}) } })`),
  ).toEqual(['probe.ts:1 updateOne of enabled'])
  expect(probe(`agentTriggers().updateOne({ _id }, update)`)).toEqual([
    'probe.ts:1 updateOne of an update it cannot read',
  ])
  expect(probe(`agentTriggers().updateOne({ _id }, { $set: { lastFiredAt: now } })`)).toEqual([])
  expect(
    probe(`writeTrigger(change, (session) => agentTriggers().deleteOne({ _id }, { session }))`),
  ).toEqual([])
})
