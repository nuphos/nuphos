import { tool } from 'ai'
import { z } from 'zod'

import { findEmbeddedSecret } from '@/lib/secrets/scan'

import {
  decodeSkillFileContent,
  skillFileContentType,
  skillFileEncodingInput,
  skillFileSecret,
} from './skill-file-content'
import {
  assertSkillNameNotBuiltinOverlay,
  buildSkillMdContent,
  deleteSkillByName,
  getSkillManifest,
  putSkillObjects,
  skillObjectKeyForName,
  validateSkillName,
  validateSkillObjectKey,
  validateSkillRelativePath,
} from './skill-store/service'
import { label, requireScopeAccess, run, scopeInput } from './tools-team-skills-access'

import type { ScopeNeed, SkillScopeName } from './tools-team-skills-access'

const skillFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Path relative to the skill directory, e.g. "scripts/run.sh" or "references/notes.md".',
    ),
  content: z.string().describe('File content: UTF-8 text, or base64 with `encoding: "base64"`.'),
  encoding: skillFileEncodingInput,
})

type ScopeAccess = (scope: SkillScopeName, need: ScopeNeed) => ReturnType<typeof requireScopeAccess>

function createSkillListTool(access: ScopeAccess) {
  return tool({
    description:
      'List the skills stored in one scope: the team store (default) or, with `scope: "personal"`, the conversation owner\'s personal skills. Read-only. ' +
      'Use before `skill_create` or `skill_upsert` to see what already exists. Builtin skills are not listed.',
    inputSchema: z.object({ label, scope: scopeInput }),
    execute: async (input) =>
      run(async () => {
        const resolved = await access(input.scope, 'read')

        if (!resolved.ok) return resolved
        const manifest = await getSkillManifest(resolved.scope)

        return {
          ok: true,
          scope: resolved.scope,
          skills: manifest.skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            fileCount: skill.fileCount,
          })),
          truncated: manifest.truncated,
        }
      }),
  })
}

/** Team and personal skill authoring, offered to every team conversation; each call checks access. */
export function createTeamSkillTools(
  userId: string,
  teamId: string,
  auditContext?: {
    conversationId?: string | null
    requestId?: string | null
    /** Whose personal skills `scope: 'personal'` addresses; the actor when unset. */
    conversationOwnerUserId?: string
  },
) {
  const access: ScopeAccess = (scope, need) =>
    requireScopeAccess({
      userId,
      teamId,
      ownerUserId: auditContext?.conversationOwnerUserId ?? userId,
      scope: scope ?? 'team',
      need,
    })

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
      'Create a NEW agent skill. By default it is team-shared: written under `teams/<teamId>/skills/<name>/` so every future chat in this team can `skill()` it. ' +
      'With `scope: "personal"` it is written to the conversation owner\'s personal skills instead, loaded only on that owner\'s turns; use that when the user asks for a skill for themselves only. ' +
      'Use when the user explicitly asks to add, document, or codify a repeatable playbook (deploy checklist, incident runbook, provider workflow). ' +
      'Confirm the skill name and scope with the user in plain language BEFORE calling — a team skill mutates shared team state. ' +
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
      scope: scopeInput,
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
        const resolved = await access(input.scope, 'write')

        if (!resolved.ok) return resolved
        const { scope } = resolved
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
        const secretHit = await findEmbeddedSecret(skillMd)

        if (secretHit) {
          return { ok: false, error: `unsafe_content: ${secretHit}` }
        }

        const extraFiles: { key: string; body: Buffer; contentType: string }[] = []

        for (const file of input.files ?? []) {
          const rel = validateSkillRelativePath(file.path)

          if (rel === 'SKILL.md') {
            return { ok: false, error: 'invalid_input: put SKILL.md content in body, not files[]' }
          }
          const body = decodeSkillFileContent(file.path, file.content, file.encoding)
          const secret = await skillFileSecret(body)

          if (secret) return { ok: false, error: `unsafe_content: ${secret}` }
          extraFiles.push({
            key: skillObjectKeyForName(name, rel),
            body,
            contentType: skillFileContentType(file.encoding),
          })
        }

        const skillMdKey = skillObjectKeyForName(name, 'SKILL.md')
        const writes = [
          {
            key: skillMdKey,
            body: Buffer.from(skillMd, 'utf8'),
            contentType: 'text/markdown',
          },
          ...extraFiles,
        ]

        await putSkillObjects(scope, writes, mutationContext(toolCallId))

        return {
          ok: true,
          name,
          scope,
          files: writes.map((write) => write.key),
          note:
            input.scope === 'personal'
              ? "Skill is persisted in the conversation owner's personal skills. It is loaded on the owner's next turn; a team skill with the same name wins over it."
              : 'Skill is persisted for the team. It will appear in the skill registry on the next agent turn; call skill() to load the full SKILL.md body.',
        }
      }),
  })

  const skill_upsert = tool({
    description:
      'Create or replace one or more files in an existing (or new) skill: team-shared by default, or with `scope: "personal"` one of the conversation owner\'s personal skills. ' +
      'Each file key must be `skills/<name>/...` relative to the chosen scope. ' +
      'Use to revise SKILL.md, add scripts, or fix playbooks the user asked you to update. ' +
      'Binary files (images, audio, archives) go in as base64 with `encoding: "base64"`, up to 10 MB each once decoded. ' +
      'Confirm with the user before mutating shared team skills. Never store secrets or private keys in skill files.',
    inputSchema: z.object({
      label,
      scope: scopeInput,
      files: z
        .array(
          z.object({
            key: z
              .string()
              .min(1)
              .describe('Object key relative to the scope, e.g. skills/deploy-checklist/SKILL.md'),
            content: z
              .string()
              .describe('File content: UTF-8 text, or base64 with `encoding: "base64"`.'),
            encoding: skillFileEncodingInput,
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async (input, { toolCallId }) =>
      run(async () => {
        const resolved = await access(input.scope, 'write')

        if (!resolved.ok) return resolved
        const { scope } = resolved
        const pending: { key: string; body: Buffer; contentType: string }[] = []

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
          const body = decodeSkillFileContent(file.key, file.content, file.encoding)
          const secret = await skillFileSecret(body)

          if (secret) return { ok: false, error: `unsafe_content: ${secret}` }
          pending.push({ key, body, contentType: skillFileContentType(file.encoding) })
        }

        await putSkillObjects(scope, pending, mutationContext(toolCallId))

        return {
          ok: true,
          scope,
          files: pending.map((file) => file.key),
          note: 'Files saved. Updated skills appear in the registry on the next agent turn.',
        }
      }),
  })

  const skill_delete = tool({
    description:
      'Delete a whole skill (every file under `skills/<name>/`) from the team store, or with `scope: "personal"` from the conversation owner\'s personal skills. ' +
      'Destructive and not undoable: call it only when the user explicitly asked to delete this skill by name in this conversation, never to tidy up on your own. ' +
      'Same rule as the Skills page: only an ADMINISTRATOR can delete a team skill; the owner can delete their own personal skills.',
    inputSchema: z.object({
      label,
      scope: scopeInput,
      name: z.string().min(1).max(80).describe('Skill directory name, e.g. "deploy-checklist".'),
    }),
    execute: async (input, { toolCallId }) =>
      run(async () => {
        const resolved = await access(input.scope, 'delete')

        if (!resolved.ok) return resolved
        const result = await deleteSkillByName(
          resolved.scope,
          input.name,
          mutationContext(toolCallId),
        )

        return {
          ok: true,
          scope: resolved.scope,
          name: result.name,
          deletedCount: result.deletedCount,
        }
      }),
  })

  return { skill_list: createSkillListTool(access), skill_create, skill_upsert, skill_delete }
}
