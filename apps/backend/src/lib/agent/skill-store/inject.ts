import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeJoinUnder } from './safe-path'

type InjectableSandbox = {
  runCommand(
    command: string,
    args?: string[],
  ): Promise<{
    exitCode?: number
    stdout?: (...args: unknown[]) => Promise<string>
    stderr?: (...args: unknown[]) => Promise<string>
  }>
  writeFiles(files: { path: string; content: string | Uint8Array | Buffer }[]): Promise<void>
}

const CODE_SKILLS_DIRECTORY = fileURLToPath(new URL('../builtin-skills/skills', import.meta.url))
const MERGE_FINGERPRINT_FILE = '.merge-fingerprint'

export async function probeSandboxWorkdir(sandbox: InjectableSandbox): Promise<string> {
  const result = await sandbox.runCommand('bash', ['-c', 'pwd'])
  const stdout = result.stdout ? await result.stdout() : ''
  const workdir = stdout.trim()

  if (!workdir) throw new Error('Failed to probe sandbox working directory')

  return workdir
}

export function getBuiltinSkillsDirectory(): string {
  return CODE_SKILLS_DIRECTORY
}

/** @deprecated Use getBuiltinSkillsDirectory */
export function getCodeSkillsDirectory(): string {
  return getBuiltinSkillsDirectory()
}

export async function collectSkillFiles(
  dir: string,
  relDir = '',
  out: { relPath: string; content: Buffer }[] = [],
): Promise<{ relPath: string; content: Buffer }[]> {
  let entries: import('node:fs').Dirent[]

  try {
    entries = await fs.readdir(path.join(dir, relDir), { withFileTypes: true })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out
    throw err
  }

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === MERGE_FINGERPRINT_FILE) continue
    const relPath = path.join(relDir, entry.name)
    const absPath = path.join(dir, relPath)

    if (entry.isDirectory()) {
      await collectSkillFiles(dir, relPath, out)
    } else if (entry.isFile()) {
      out.push({
        relPath: relPath.split(path.sep).join(path.posix.sep),
        content: await fs.readFile(absPath),
      })
    }
  }

  return out
}

export async function injectSkills(
  sandbox: InjectableSandbox,
  skillsDirectory: string,
  workdir?: string,
): Promise<{ workdir: string; fileCount: number }> {
  const resolvedWorkdir = workdir ?? (await probeSandboxWorkdir(sandbox))
  const files = await collectSkillFiles(skillsDirectory)

  await sandbox.writeFiles(
    files.map((file) => ({
      path: safeJoinUnder(resolvedWorkdir, path.posix.join('skills', file.relPath)),
      content: file.content,
    })),
  )

  return { workdir: resolvedWorkdir, fileCount: files.length }
}

export async function injectCodeSkills(
  sandbox: InjectableSandbox,
  workdir?: string,
): Promise<{ workdir: string; fileCount: number }> {
  return injectSkills(sandbox, CODE_SKILLS_DIRECTORY, workdir)
}
