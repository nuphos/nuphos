// codex-acp 1.1.4 has no session-scoped instructions/environment extension.
// Patch the three config handoffs, and release the thread before a load or
// resume so its config applies, in the locked upstream bundle. Fail
// the build if its bytes change, so adapter upgrades require a reviewed port.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { patchRuntimeDefaults } from '../runtime-defaults.mjs'

export function patchAdapter(source, helper) {
  const sessionHome = readFileSync(new URL('../session-home.mjs', import.meta.url), 'utf8')
  helper = helper.replace("import { nuphosSessionHomeEnv } from '../session-home.mjs'", '')
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== '7534a0ad3cc4c9affd0b2da5007fa53ea0f1d6fcd71b2c5ef202e2056a976a97')
    throw new Error(
      'Codex ACP bundle changed; review the Nuphos session config patch before upgrading.',
    )
  const pattern =
    /config: await this\.createSessionConfig\(request\.cwd, additionalDirectories, request\.mcpServers( \?\? \[\])?\),/g
  let count = 0
  const patched = source.replace(pattern, (_, fallback = '') => {
    count++
    return `config: nuphosCodexSessionConfig(await this.createSessionConfig(request.cwd, additionalDirectories, nuphosBridgeMcpServers(request.mcpServers${fallback})), request._meta),`
  })
  if (count !== 3) throw new Error('Expected exactly three Codex session config handoffs.')

  const steering = readFileSync(new URL('./steering.mjs', import.meta.url), 'utf8').replace(
    'export async function',
    'async function',
  )
  const mcpBridge = readFileSync(
    new URL('../mcp-bridge-config.mjs', import.meta.url),
    'utf8',
  ).replace('export function', 'function')
  const routeAnchor =
    '.onRequest(GOAL_CONTROL_METHOD, goalControlParamsParser, (ctx) => getAgent().extMethod(GOAL_CONTROL_METHOD, ctx.params))'
  const initializeAnchor = '      authMethods: getCodexAuthMethods(_params.clientCapabilities)'
  if (patched.split(routeAnchor).length !== 2 || patched.split(initializeAnchor).length !== 2)
    throw new Error('Expected Codex steering route and capability handoffs')
  const withSteering = patched
    .replace(
      routeAnchor,
      routeAnchor +
        '.onRequest("_session/steering", { parse: (params) => params }, (ctx) => nuphosSteerCodex(getAgent(), ctx.params, buildPromptItems))',
    )
    .replace(
      initializeAnchor,
      '      _meta: { steering: { supported: true } },\n' + initializeAnchor,
    )

  // A teammate's load must reach a thread this process already holds; see
  // nuphosReleaseMovedThread. New threads record the home they started in.
  const resumeCall = '    const response = await this.codexClient.threadResume({'
  const startCall = '    const response = await this.codexClient.threadStart({'
  const startAnchor =
    '      cwd: request.cwd\n    });\n    const codexModels = await this.fetchAvailableModels();\n    if (codexModels.length === 0) {'
  if (
    withSteering.split(resumeCall).length !== 3 ||
    withSteering.split(startCall).length !== 2 ||
    withSteering.split(startAnchor).length !== 2
  )
    throw new Error('Expected Codex start, load and resume thread handoffs')
  // thread/resume already returns populated turns. Reading the same history
  // again can exhaust the load deadline for image-heavy conversations.
  const historyRead = `    const historyResponse = await this.codexClient.threadRead({
      threadId: response.thread.id,
      includeTurns: true
    });`
  const historyResult = '      thread: historyResponse.thread,'
  if (
    withSteering.split(historyRead).length !== 2 ||
    withSteering.split(historyResult).length !== 2
  )
    throw new Error('Expected one Codex load history read and result handoff')
  const resubscribing = withSteering
    .replace(historyRead, '')
    .replace(historyResult, '      thread: response.thread,')
    .replaceAll(
      resumeCall,
      '    await nuphosReleaseMovedThread(this.codexClient, request.sessionId, request._meta);\n' +
        resumeCall,
    )
    .replace(
      startAnchor,
      startAnchor.replace(
        '    });\n',
        '    });\n    nuphosRememberThreadHome(response.thread.id, request._meta);\n',
      ),
    )

  const restoreHistory = readFileSync(
    new URL('./restore-history.mjs', import.meta.url),
    'utf8',
  ).replaceAll('export function', 'function')
  const readerStart = 'function createJSONRPCReader(readable) {\n  return {\n    listen(callback) {'
  const readerEnd = '\n    onError: new import_node.Emitter().event,'
  const start = resubscribing.indexOf(readerStart)
  const end = resubscribing.indexOf(readerEnd, start)
  const fallback = '    const record2 = parseJsonRecord(line);'
  if (start < 0 || end < 0 || resubscribing.split(fallback).length !== 2)
    throw new Error('Expected Codex JSON reader and history fallback handoffs')
  const withRestore = (
    resubscribing.slice(0, start) +
    readerStart +
    '\n      return nuphosListenJsonLines(readable, callback);\n    },' +
    resubscribing.slice(end)
  )
    .replace(
      '      thread: response.thread,',
      '      thread: nuphosOmitRestoreImages(response.thread),',
    )
    .replace(fallback, '    const record2 = nuphosOmitRestoreImages(parseJsonRecord(line));')

  // The upstream adapter hardcodes a speed multiplier that newer models do
  // not share. Preserve the usage tradeoff without claiming a fixed speed.
  return patchRuntimeDefaults(
    withRestore
      .replace(
        'var FAST_MODE_DESCRIPTION = "1.5x speed, increased usage";',
        'var FAST_MODE_DESCRIPTION = "Faster responses, increased usage";',
      )
      .replace(
        '// src/index.ts',
        `${restoreHistory}\n${sessionHome}\n${helper}\n${steering}\n${mcpBridge}\n// src/index.ts`,
      ),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]
  const helper = readFileSync(new URL('./session-config.mjs', import.meta.url), 'utf8')
  writeFileSync(target, patchAdapter(readFileSync(target, 'utf8'), helper))
}
