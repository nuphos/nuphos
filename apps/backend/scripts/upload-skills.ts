#!/usr/bin/env bun
// Seed skill packages into the S3 skills store (Mode 1 hosted / Mode 2 self-host).
//
// Uploads a local directory of skill folders into one scope:
//   global  → s3://$ATLAS_SKILLS_BUCKET/global/skills/<name>/…
//   team    → s3://$ATLAS_SKILLS_BUCKET/teams/<teamId>/skills/<name>/…
//
// Each skill is a directory containing SKILL.md (and optional scripts/refs).
//
// Usage:
//   bun scripts/upload-skills.ts --scope global --dir ./seed-skills
//   bun scripts/upload-skills.ts --scope teams/<teamId> --dir ./team-skills
//   bun scripts/upload-skills.ts --scope global --dir ./seed-skills --dry-run
//
// Required env (same as backend skills store):
//   ATLAS_SKILLS_BUCKET
//   ATLAS_SKILLS_S3_ACCESS_KEY_ID
//   ATLAS_SKILLS_S3_SECRET_ACCESS_KEY
//   MONGODB_URI (provenance/event persistence)
// Optional:
//   ATLAS_SKILLS_S3_REGION (default us-east-1)

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { normalizeSkillScope } from '../src/lib/agent/skill-store/scope'
import {
  MAX_SKILL_UPLOAD_BYTES,
  SKILL_OBJECT_KEY_PREFIX,
  putSkillObjects,
  validateSkillName,
} from '../src/lib/agent/skill-store/service'
import { isSkillsS3Configured } from '../src/lib/agent/skill-store/skills-s3'
import { closeDb, connectDb } from '../src/lib/db'

type Args = {
  scope: string
  dir: string
  dryRun: boolean
  actorUserId: string | null
}

function usage(code = 1): never {
  console.error(`usage:
  bun scripts/upload-skills.ts --scope <global|teams/<teamId>> --dir <skills-root> [--actor-user-id <id>] [--dry-run]

options:
  --scope <scope>   Skills namespace: "global" or "teams/<teamObjectId>"
  --dir <path>      Local directory of skill folders (each with SKILL.md)
  --actor-user-id   Optional Nuphos user id to attribute this import to
  --dry-run         List objects that would be uploaded; do not write

required env:
  ATLAS_SKILLS_BUCKET
  ATLAS_SKILLS_S3_ACCESS_KEY_ID
  ATLAS_SKILLS_S3_SECRET_ACCESS_KEY
  MONGODB_URI

optional env:
  ATLAS_SKILLS_S3_REGION`)
  process.exit(code)
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const out: Partial<Args> = { dryRun: false, actorUserId: null }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--scope') out.scope = argv[++i]
    else if (arg === '--dir') out.dir = argv[++i]
    else if (arg === '--actor-user-id') out.actorUserId = argv[++i] ?? null
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--help' || arg === '-h') usage(0)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!out.scope || !out.dir) usage()

  return {
    scope: out.scope,
    dir: out.dir,
    dryRun: out.dryRun ?? false,
    actorUserId: out.actorUserId ?? null,
  }
}

function guessContentType(relPath: string): string {
  if (relPath.endsWith('.md')) return 'text/markdown'
  if (relPath.endsWith('.json')) return 'application/json'
  if (relPath.endsWith('.sh')) return 'text/x-shellscript'
  if (relPath.endsWith('.ts') || relPath.endsWith('.js')) return 'text/plain'
  if (relPath.endsWith('.yml') || relPath.endsWith('.yaml')) return 'text/yaml'

  return 'application/octet-stream'
}

async function collectFiles(
  root: string,
  relDir = '',
  out: { relPath: string; absPath: string }[] = [],
): Promise<{ relPath: string; absPath: string }[]> {
  const entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue
    const relPath = path.posix.join(relDir.split(path.sep).join(path.posix.sep), entry.name)
    const absPath = path.join(root, relDir, entry.name)

    if (entry.isDirectory()) {
      await collectFiles(root, path.join(relDir, entry.name), out)
    } else if (entry.isFile()) {
      out.push({ relPath, absPath })
    }
  }

  return out
}

async function main(): Promise<void> {
  const args = parseArgs()
  const scope = normalizeSkillScope(args.scope)
  const skillsRoot = path.resolve(args.dir)

  if (!args.dryRun && !isSkillsS3Configured()) {
    throw new Error(
      'Skills store env not set (need ATLAS_SKILLS_BUCKET + ATLAS_SKILLS_S3_ACCESS_KEY_ID + ATLAS_SKILLS_S3_SECRET_ACCESS_KEY)',
    )
  }

  const skillDirs = (await fs.readdir(skillsRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  if (skillDirs.length === 0) {
    throw new Error(`No skill directories under ${skillsRoot}`)
  }

  if (!args.dryRun) await connectDb()
  let uploaded = 0
  let skipped = 0
  let bytes = 0

  try {
    for (const name of skillDirs) {
      const skillName = validateSkillName(name)
      const skillDir = path.join(skillsRoot, skillName)
      const skillMd = path.join(skillDir, 'SKILL.md')

      try {
        await fs.access(skillMd)
      } catch {
        console.warn(`skip ${skillName}: missing SKILL.md`)
        skipped++
        continue
      }

      const files = await collectFiles(skillDir)
      const writes = []

      for (const file of files) {
        const body = await fs.readFile(file.absPath)

        if (body.byteLength > MAX_SKILL_UPLOAD_BYTES) {
          throw new Error(`${skillName}/${file.relPath} exceeds ${MAX_SKILL_UPLOAD_BYTES} bytes`)
        }
        const relativeKey = `${SKILL_OBJECT_KEY_PREFIX}${skillName}/${file.relPath}`

        writes.push({
          key: relativeKey,
          body,
          contentType: guessContentType(file.relPath),
        })
        if (args.dryRun) {
          console.log(`would put ${scope}/${relativeKey} (${body.byteLength} bytes)`)
        }
        uploaded++
        bytes += body.byteLength
      }

      if (!args.dryRun) {
        await putSkillObjects(scope, writes, {
          actor: { userId: args.actorUserId, source: 'import' },
        })
        for (const write of writes) {
          console.log(`put ${scope}/${write.key} (${write.body.byteLength} bytes)`)
        }
      }
    }
  } finally {
    if (!args.dryRun) await closeDb()
  }

  console.log(
    args.dryRun
      ? `dry-run: ${uploaded} objects, ${bytes} bytes, ${skipped} skills skipped, scope=${scope}`
      : `done: ${uploaded} objects, ${bytes} bytes, ${skipped} skills skipped, scope=${scope}`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
