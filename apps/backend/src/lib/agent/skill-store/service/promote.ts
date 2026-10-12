import { AppError } from '@/lib/errors'

import { normalizeSkillScope } from '../scope'

import { deleteSkillByName } from './delete'
import { putSkillObjects } from './put'
import {
  listSkillPackageObjects,
  requireSkillsStore,
  scopeRelativeKey,
  validateSkillName,
} from './shared'

import type { SkillMutationContext, SkillObject } from './types'

/**
 * Move one skill package between scopes. The source copy is removed once the
 * destination holds it, so a promoted personal skill cannot keep shadowing the
 * team copy it became.
 */
export async function promoteSkill(
  fromScope: string,
  toScope: string,
  name: string,
  context: SkillMutationContext,
): Promise<SkillObject[]> {
  const from = normalizeSkillScope(fromScope)
  const skillName = validateSkillName(name)
  const s3 = requireSkillsStore(from)
  const objects = await listSkillPackageObjects(s3, from, skillName)

  if (objects.length === 0) {
    throw new AppError(404, 'skill_not_found', `Skill not found: ${skillName}`)
  }
  const to = normalizeSkillScope(toScope)

  if ((await listSkillPackageObjects(s3, to, skillName)).length > 0) {
    throw new AppError(409, 'skill_exists', `A skill named ${skillName} already exists there`)
  }
  const writes = await Promise.all(
    objects.map(async (object) => ({
      key: scopeRelativeKey(from, object.key),
      body: await s3.getObjectBody(object.key),
    })),
  )
  // Each half is its own mutation, so a retry of the request replays neither twice.
  const step = (suffix: string): SkillMutationContext => ({
    ...context,
    mutationId: context.mutationId ? `${context.mutationId}:${suffix}` : undefined,
  })
  const saved = await putSkillObjects(to, writes, step('promote'))

  await deleteSkillByName(from, skillName, step('promote-cleanup'))

  return saved
}
