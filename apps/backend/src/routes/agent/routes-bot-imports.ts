import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'
import { Hono } from 'hono'

import { withBotImportAdmission } from '@/lib/agent/bot-import/admission'
import { applyImportBatch, assertImportSelection } from '@/lib/agent/bot-import/batch'
import { BUNDLE_LIMITS } from '@/lib/agent/bot-import/manifest'
import { checkImportDestination, importOperations } from '@/lib/agent/bot-import/operations'
import {
  botImportPreview,
  claimBotImport,
  discardBotImport,
  getBotImport,
  readStagedBotBundle,
  stageBotBundle,
} from '@/lib/agent/bot-import/store'
import { readBoundedBody } from '@/lib/agent/inbound-files'
import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'
import { isOpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import { assertRuntimeFileImportSupported } from '@/lib/claude-code-preview/runtime-file-import-capability'
import { AppError } from '@/lib/errors'
import { requireAuth } from '@/middleware/auth'

import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { ImportOwner } from '@/lib/agent/bot-import/batch'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

export const botImportRoutes = new Hono<{ Variables: AuthVariables }>()
// Mounted at /agent beside the main agent router: a '*' middleware would gate every /agent route.
botImportRoutes.use('/bot-imports/*', requireAuth)

async function ownerOf(c: Context<{ Variables: AuthVariables }>): Promise<ImportOwner> {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const runtimeId = c.req.query('runtimeId') ?? ''
  const agentRuntime = c.req.query('agentRuntime')

  if (!teamId || !runtimeId || runtimeId.length > 500 || !isOpenAbProvider(agentRuntime))
    throw new AppError(400, 'invalid_import_target', 'Choose a workspace and an accessible agent')

  return { userId: c.get('userId'), teamId, runtimeId, agentRuntime }
}

botImportRoutes.get('/bot-imports/export-skill', async (c) => {
  const content = await readFile(
    join(getBuiltinSkillsDirectory(), 'grok-bot-export', 'SKILL.md'),
    'utf8',
  )

  return c.text(content, 200, { 'content-disposition': 'attachment; filename="SKILL.md"' })
})

botImportRoutes.post('/bot-imports/preview', (c) =>
  withBotImportAdmission(async () => {
    const owner = await ownerOf(c)

    await checkImportDestination(owner)
    const bytes = await readBoundedBody(new Response(c.req.raw.body), BUNDLE_LIMITS.uploadBytes)

    if (!bytes) throw new AppError(413, 'import_size_limit', 'Choose a ZIP smaller than 100 MiB')
    const copy = c.req.query('copyId') ?? ''

    if (copy && !z.string().uuid().safeParse(copy).success)
      throw new AppError(400, 'invalid_request', 'copyId must identify an explicit new copy')
    try {
      const staged = await stageBotBundle(owner, bytes, copy)

      if (staged.manifest.bots.some((bot) => bot.files.length > 0))
        await assertRuntimeFileImportSupported(owner.teamId, owner.userId, owner.runtimeId)

      return c.json(botImportPreview(staged))
    } catch (error) {
      // Parser and system failures never echo a filename, secret or host path to the client.
      if (error instanceof AppError) throw error
      throw new AppError(
        400,
        'invalid_bot_bundle',
        'The export is invalid, unsafe or unsupported. Check the Nuphos export instructions and remove credentials before exporting again.',
      )
    }
  }),
)

botImportRoutes.get('/bot-imports/:batchId', async (c) =>
  c.json(botImportPreview(await getBotImport(c.req.param('batchId'), await ownerOf(c)))),
)

const selection = z
  .object({
    botKeys: z.array(z.string().max(64)).max(100),
    chatKeys: z.array(z.string().max(64)).max(100),
    enableSchedules: z.boolean(),
    scheduleActivationConfirmed: z.boolean().default(false),
  })
  .strict()

botImportRoutes.post('/bot-imports/:batchId/apply', (c) =>
  withBotImportAdmission(async () => {
    const owner = await ownerOf(c)
    const parsed = selection.safeParse(await c.req.json().catch(() => null))

    if (!parsed.success) throw new AppError(400, 'invalid_request', 'Invalid import selection')
    if (parsed.data.enableSchedules && !parsed.data.scheduleActivationConfirmed)
      throw new AppError(
        400,
        'schedule_confirmation_required',
        'Confirm the schedule activation shown in the preview',
      )
    await checkImportDestination(owner)
    const claimed = await claimBotImport(c.req.param('batchId'), owner)

    try {
      assertImportSelection(claimed.batch, parsed.data)
      await claimed.select({
        botKeys: parsed.data.botKeys,
        chatKeys: parsed.data.chatKeys,
        enableSchedules: parsed.data.enableSchedules,
      })
      const archive = await readStagedBotBundle(claimed.batch)
      const operations = importOperations(claimed.batch, archive, claimed.save)

      await applyImportBatch(claimed.batch, owner, parsed.data, operations)

      return c.json({ ...botImportPreview(claimed.batch), running: false })
    } finally {
      await claimed.release()
    }
  }),
)

botImportRoutes.delete('/bot-imports/:batchId/stage', async (c) => {
  await discardBotImport(c.req.param('batchId'), await ownerOf(c))

  return c.body(null, 204)
})
