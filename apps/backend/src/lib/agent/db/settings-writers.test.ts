import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test } from 'bun:test'
import ts from 'typescript'

// A conversation's agent, model, effort and fast mode change only through
// updateConversationSettings, which records each change. Any other write to
// these paths would change them silently.
const SETTINGS =
  /^(initialSessionConfig|claudeCodePreview(\..+)?|runtimeId|settingsHistory|settingsRevision)$/
const WRITES = new Set(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'])
const OPERATORS = new Set(['$set', '$unset', '$push', '$inc', '$rename'])
const SRC = join(import.meta.dir, '../../..')
const OWNER = 'lib/agent/db/settings-history.ts'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path)

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

// Keys an object literal may write, through spreads like `...(pick ? { x } : {})`.
function keys(node: ts.Node | undefined): { name: string; value?: ts.Node }[] {
  if (!node) return []
  if (ts.isParenthesizedExpression(node)) return keys(node.expression)
  if (ts.isConditionalExpression(node)) return [...keys(node.whenTrue), ...keys(node.whenFalse)]
  if (ts.isBinaryExpression(node)) return keys(node.right)
  if (!ts.isObjectLiteralExpression(node)) return []

  return node.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return keys(property.expression)
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = property.name.getText().replace(/^['"]|['"]$/g, '')

      return [{ name, value: ts.isPropertyAssignment(property) ? property.initializer : undefined }]
    }

    return []
  })
}

function settingsWriters(file: string): string[] {
  const text = readFileSync(file, 'utf8')

  if (!text.includes('agentConversations')) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITES.has(node.expression.name.text) &&
      node.expression.expression.getText().includes('agentConversations')
    ) {
      const written = keys(node.arguments[1])
        .filter(({ name }) => OPERATORS.has(name))
        .flatMap(({ value }) => keys(value).map(({ name }) => name))
        .filter((name) => SETTINGS.test(name))

      if (written.length) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())

        found.push(`${relative(SRC, file)}:${String(line + 1)} writes ${written.join(', ')}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)

  return found
}

test('only updateConversationSettings writes a conversation’s agent and model settings', () => {
  const writers = sources(SRC)
    .filter((file) => relative(SRC, file) !== OWNER)
    .flatMap(settingsWriters)

  expect(writers).toEqual([])
})

test('the guard sees a write through a conditional spread', () => {
  const source = `agentConversations().updateOne({ sessionId }, { $set: { ...(pick ? { initialSessionConfig: pick } : {}) } })`
  const file = join(import.meta.dir, 'guard-probe.ts')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const call = (parsed.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression
  const written = keys(call.arguments[1])
    .filter(({ name }) => OPERATORS.has(name))
    .flatMap(({ value }) => keys(value).map(({ name }) => name))

  expect(written).toEqual(['initialSessionConfig'])
})
