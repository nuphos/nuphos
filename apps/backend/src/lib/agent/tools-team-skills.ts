import { tool } from 'ai'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import {
  assertSkillNameNotBuiltinOverlay,
  buildSkillMdContent,
  getSkillManifest,
  isSkillsStoreConfigured,
  putSkillObjects,
  skillObjectKeyForName,
  teamSkillsScope,
  validateSkillName,
  validateSkillObjectKey,
  validateSkillRelativePath,
} from './skill-store/service'

import type { AgentSessionOrigin } from './tools-triggers'

const label = z
  .string()
  .min(1)
  .max(160)
  .describe('Short human-readable description of this single action, shown to the user as a step.')

const skillFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Path relative to the skill directory, e.g. "scripts/run.sh" or "references/notes.md".',
    ),
  content: z.string().describe('UTF-8 text file content.'),
})

async function run<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: `${err.code}: ${err.message}` }
    throw err
  }
}

async function requireEditorAccess(
  userId: string,
  teamId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const membership = await getTeamMembership(userId, teamId)

  if (!membership) {
    return { ok: false, error: 'forbidden: you are not a member of this team' }
  }
  if (membership.role === 'VIEWER') {
    return { ok: false, error: 'forbidden: VIEWER role cannot create or update team skills' }
  }

  return { ok: true }
}

function looksLikeEmbeddedSecret(text: string): string | null {
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) {
    return 'content appears to contain an AWS access key id'
  }
  if (/\bsk-[a-zA-Z0-9]{20,}\b/.test(text)) {
    return 'content appears to contain a secret API key'
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    return 'content appears to contain a private key'
  }

  return null
}

export async function createTeamSkillTools(
  userId: string,
  teamId: string | null | undefined,
  origin: AgentSessionOrigin,
  auditContext?: { conversationId?: string | null; requestId?: string | null },
) {
  if (!teamId || !isSkillsStoreConfigured() || origin === 'trigger') {
    return {}
  }

  const membership = await getTeamMembership(userId, teamId)

  if (!membership || membership.role === 'VIEWER') {
    return {}
  }

  const scope = teamSkillsScope(teamId)

  const mutationContext = (toolCallId: string) => ({
    mutationId: auditContext?.conversationId
      ? `${auditContext.conversationId}:${auditContext.requestId ?? 'request'}:${toolCallId}`
      : undefined,
    actor: {
      userId,
      source: 'agent' as const,
      requestId: auditContext?.requestId ?? null,
      conversationId: auditContext?.conversationId ?? null,
      toolCallId,
    },
  })

  const skill_create = tool({
    description:
      'Create a NEW team-shared agent skill for this team. Writes under `teams/<teamId>/skills/<name>/` in the skills store so every future chat in this team can `skill()` it. ' +
      'Use when the user explicitly asks to add, document, or codify a repeatable playbook for the whole team (deploy checklist, incident runbook, provider workflow). ' +
      'Confirm the skill name and scope with the user in plain language BEFORE calling — this mutates shared team state. ' +
      'Do NOT store secrets, API keys, tokens, or private keys in skill files; reference env vars or Nuphos credential flows instead. ' +
      'If the skill already exists, use `skill_upsert` to revise it instead of creating a duplicate.',
    inputSchema: z.object({
      label,
      name: z
        .string()
        .min(1)
        .max(80)
        .describe(
          'Skill directory name (e.g. "deploy-checklist"). Becomes skills/<name>/ in the store.',
        ),
      description: z
        .string()
        .min(1)
        .max(500)
        .describe('One-line description for SKILL.md frontmatter and the skills registry.'),
      body: z
        .string()
        .describe(
          'Markdown body for SKILL.md AFTER the YAML frontmatter (workflows, commands, cautions).',
        ),
      files: z
        .array(skillFileInputSchema)
        .max(20)
        .optional()
        .describe('Optional extra files (scripts, references) relative to the skill directory.'),
    }),
    execute: async (input, { toolCallId }) =>
      run(async () => {
        const access = await requireEditorAccess(userId, teamId)

        if (!access.ok) return access

        const name = validateSkillName(input.name)

        await assertSkillNameNotBuiltinOverlay(name)
        const manifest = await getSkillManifest(scope)

        if (manifest.skills.some((skill) => skill.name === name)) {
          return {
            ok: false,
            error: `skill_already_exists: skills/${name}/ already exists — use skill_upsert to update it`,
          }
        }

        const skillMd = buildSkillMdContent(name, input.description, input.body)
        const secretHit = looksLikeEmbeddedSecret(skillMd)

        if (secretHit) {
          return { ok: false, error: `unsafe_content: ${secretHit}` }
        }

        const extraFiles: { key: string; content: string }[] = []

        for (const file of input.files ?? []) {
          const rel = validateSkillRelativePath(file.path)

          if (rel === 'SKILL.md') {
            return { ok: false, error: 'invalid_input: put SKILL.md content in body, not files[]' }
          }
          const secret = looksLikeEmbeddedSecret(file.content)

          if (secret) return { ok: false, error: `unsafe_content: ${secret}` }
          extraFiles.push({
            key: skillObjectKeyForName(name, rel),
            content: file.content,
          })
        }

        const skillMdKey = skillObjectKeyForName(name, 'SKILL.md')
        const writes = [
          {
            key: skillMdKey,
            body: Buffer.from(skillMd, 'utf8'),
            contentType: 'text/markdown',
          },
          ...extraFiles.map((file) => ({
            key: file.key,
            body: Buffer.from(file.content, 'utf8'),
            contentType: 'text/plain',
          })),
        ]

        await putSkillObjects(scope, writes, mutationContext(toolCallId))

        return {
          ok: true,
          name,
          scope,
          files: writes.map((write) => write.key),
          note: 'Skill is persisted for the team. It will appear in the skill registry on the next agent turn; call skill() to load the full SKILL.md body.',
        }
      }),
  })

  const skill_upsert = tool({
    description:
      'Create or replace one or more files in an existing (or new) team-shared skill. ' +
      'Each file key must be `skills/<name>/...` relative to the team scope. ' +
      'Use to revise SKILL.md, add scripts, or fix team playbooks the user asked you to update. ' +
      'Confirm with the user before mutating shared team skills. Never store secrets or private keys in skill files.',
    inputSchema: z.object({
      label,
      files: z
        .array(
          z.object({
            key: z
              .string()
              .min(1)
              .describe('Object key relative to team scope, e.g. skills/deploy-checklist/SKILL.md'),
            content: z.string().describe('UTF-8 text file content.'),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async (input, { toolCallId }) =>
      run(async () => {
        const access = await requireEditorAccess(userId, teamId)

        if (!access.ok) return access

        const pending: { key: string; content: string }[] = []

        for (const file of input.files) {
          const key = validateSkillObjectKey(file.key)
          const parts = key.split('/')

          if (parts.length < 3 || parts[0] !== 'skills' || !parts[1]) {
            return {
              ok: false,
              error: `invalid_input: key must be skills/<name>/... (${file.key})`,
            }
          }
          const skillName = validateSkillName(parts[1])

          await assertSkillNameNotBuiltinOverlay(skillName)
          const secret = looksLikeEmbeddedSecret(file.content)

          if (secret) return { ok: false, error: `unsafe_content: ${secret}` }
          pending.push({ key, content: file.content })
        }

        await putSkillObjects(
          scope,
          pending.map((file) => ({
            key: file.key,
            body: Buffer.from(file.content, 'utf8'),
            contentType: 'text/plain',
          })),
          mutationContext(toolCallId),
        )

        return {
          ok: true,
          scope,
          files: pending.map((file) => file.key),
          note: 'Files saved. Updated skills appear in the registry on the next agent turn.',
        }
      }),
  })

  return { skill_create, skill_upsert }
}
