import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getShortLivedCredsSkillBody,
  shortLivedCredsHelperScript,
} from './agent-chat-skill/content-creds'
import {
  openInNuphosHelperScript,
  openInNuphosSkillBody,
} from './agent-chat-skill/content-open-in-nuphos'

import type {
  AgentChatSkillId,
  AgentChatSkillInstallResult,
  AgentChatSkillStatus,
  AgentChatSkillTarget,
  AgentChatSkillUninstallResult,
  SkillDefinition,
} from './agent-chat-skill/types'

export type * from './agent-chat-skill/types'

const LEGACY_SKILL_NAME = 'nuphos-agent-chat'
const TARGET_LABELS: Record<AgentChatSkillTarget, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

function skillsRoot(target: AgentChatSkillTarget): string {
  const home = os.homedir()

  return target === 'codex'
    ? path.join(home, '.agents', 'skills')
    : path.join(home, '.claude', 'skills')
}

function skillRoot(target: AgentChatSkillTarget, skill: SkillDefinition): string {
  return path.join(skillsRoot(target), skill.id)
}

function legacySkillRoot(target: AgentChatSkillTarget, legacyName: string): string {
  const home = os.homedir()

  return target === 'codex'
    ? path.join(home, '.agents', 'skills', legacyName)
    : path.join(home, '.claude', 'skills', legacyName)
}

function skillPath(target: AgentChatSkillTarget, skill: SkillDefinition): string {
  return path.join(skillRoot(target, skill), 'SKILL.md')
}

function helperPath(target: AgentChatSkillTarget, skill: SkillDefinition): string {
  return path.join(skillRoot(target, skill), 'scripts', skill.helperName)
}

function legacyHelperPath(target: AgentChatSkillTarget, skill: SkillDefinition): string | null {
  if (!skill.legacyName || !skill.legacyHelperName) return null

  return path.join(legacySkillRoot(target, skill.legacyName), 'scripts', skill.legacyHelperName)
}

const SKILLS: SkillDefinition[] = [
  {
    id: 'open-in-nuphos',
    name: 'Open in Nuphos',
    description: 'Open a Nuphos Agent chat with bug context, prompts, and local files.',
    helperName: 'open-in-nuphos',
    legacyName: LEGACY_SKILL_NAME,
    legacyHelperName: 'open-agent-chat.sh',
    skillBody: openInNuphosSkillBody,
    helperScript: openInNuphosHelperScript,
  },
  {
    id: 'get-short-lived-creds-from-nuphos',
    name: 'Get Short-Lived Creds',
    description: 'Fetch short-lived AWS, GCP, or Kubernetes credentials from Nuphos.',
    helperName: 'get-short-lived-creds-from-nuphos',
    skillBody: getShortLivedCredsSkillBody,
    helperScript: shortLivedCredsHelperScript,
  },
]

function skillById(skillId: AgentChatSkillId): SkillDefinition {
  const skill = SKILLS.find((item) => item.id === skillId)

  if (!skill) throw new Error(`Invalid skill id: ${skillId}`)

  return skill
}

export async function installAgentChatSkill(
  target: AgentChatSkillTarget,
  skillId: AgentChatSkillId,
): Promise<AgentChatSkillInstallResult> {
  if (target !== 'claude' && target !== 'codex') {
    throw new Error(`Invalid skill target: ${String(target)}`)
  }
  const skill = skillById(skillId)
  const root = skillRoot(target, skill)
  const scriptsDir = path.join(root, 'scripts')
  const operation = await fs
    .stat(skillPath(target, skill))
    .then(() => 'updated' as const)
    .catch(() => 'created' as const)

  await fs.mkdir(scriptsDir, { recursive: true })
  const scriptPath = helperPath(target, skill)

  await fs.writeFile(skillPath(target, skill), skill.skillBody(target), 'utf8')
  await fs.writeFile(scriptPath, skill.helperScript, 'utf8')
  await fs.chmod(scriptPath, 0o700)
  const oldHelperPath = legacyHelperPath(target, skill)

  if (oldHelperPath) await fs.rm(oldHelperPath, { force: true })
  if (skill.legacyName) {
    await fs.rm(legacySkillRoot(target, skill.legacyName), { recursive: true, force: true })
  }

  return { skillId: skill.id, target, path: root, operation }
}

export async function uninstallAgentChatSkill(
  target: AgentChatSkillTarget,
  skillId: AgentChatSkillId,
): Promise<AgentChatSkillUninstallResult> {
  if (target !== 'claude' && target !== 'codex') {
    throw new Error(`Invalid skill target: ${String(target)}`)
  }
  const skill = skillById(skillId)
  const root = skillRoot(target, skill)

  await fs.rm(root, { recursive: true, force: true })
  if (skill.legacyName) {
    await fs.rm(legacySkillRoot(target, skill.legacyName), { recursive: true, force: true })
  }

  return { skillId: skill.id, target, path: root, operation: 'removed' }
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)

    if (process.platform === 'win32') return stat.isFile()

    return (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

export async function getAgentChatSkillStatus(
  target: AgentChatSkillTarget,
  skillId: AgentChatSkillId,
): Promise<AgentChatSkillStatus> {
  if (target !== 'claude' && target !== 'codex') {
    throw new Error(`Invalid skill target: ${String(target)}`)
  }
  const skill = skillById(skillId)
  const root = skillRoot(target, skill)
  const currentSkillPath = skillPath(target, skill)
  const currentHelperPath = helperPath(target, skill)
  const skillContent = await readFileIfExists(currentSkillPath)
  const helperContent = await readFileIfExists(currentHelperPath)
  const helperExecutable = await isExecutable(currentHelperPath)
  const skillExists = skillContent !== null
  const helperExists = helperContent !== null
  const upToDate =
    skillContent === skill.skillBody(target) &&
    helperContent === skill.helperScript &&
    helperExecutable

  return {
    skillId: skill.id,
    skillName: skill.name,
    description: skill.description,
    target,
    label: TARGET_LABELS[target],
    path: root,
    skillPath: currentSkillPath,
    helperPath: currentHelperPath,
    installed: skillExists && helperExists,
    upToDate,
    skillExists,
    helperExists,
    helperExecutable,
  }
}

export async function listAgentChatSkillStatuses(): Promise<AgentChatSkillStatus[]> {
  return Promise.all(
    (['claude', 'codex'] as const).flatMap((target) =>
      SKILLS.map((skill) => getAgentChatSkillStatus(target, skill.id)),
    ),
  )
}

export async function ensureAgentChatSkillsFolder(target: AgentChatSkillTarget): Promise<string> {
  if (target !== 'claude' && target !== 'codex') {
    throw new Error(`Invalid skill target: ${String(target)}`)
  }
  const root = skillsRoot(target)

  await fs.mkdir(root, { recursive: true })

  return root
}
