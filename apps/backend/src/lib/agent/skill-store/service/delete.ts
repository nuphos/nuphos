import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'

import { skillMetadataRepository } from '../metadata'
import { normalizeSkillScope, skillObjectKey } from '../scope'

import {
  etagsByRelativeKey,
  listSkillPackageObjects,
  mutationError,
  refreshScopeAfterMutation,
  requireSkillsStore,
  scopeRelativeKey,
  skillNameFromObjectKey,
  validateSkillName,
  validateSkillObjectKey,
} from './shared'
import { SKILL_OBJECT_KEY_PREFIX } from './types'

import type { DeleteSkillResult, SkillMutationContext } from './types'

export async function deleteSkillObject(
  scope: string,
  key: string,
  context: SkillMutationContext,
): Promise<void> {
  const normalized = normalizeSkillScope(scope)
  const relKey = validateSkillObjectKey(key)
  const skillName = skillNameFromObjectKey(relKey)

  if (!skillName) {
    throw new AppError(400, 'invalid_input', `key must be skills/<name>/... (${relKey})`)
  }
  const s3Key = skillObjectKey(normalized, relKey)
  const s3 = requireSkillsStore(normalized)
  const repository = skillMetadataRepository()
  const mutationId = context.mutationId ?? randomUUID()
  const previousResult = await repository.getResult(mutationId)

  if (previousResult) {
    if (previousResult.status === 'applied') return
    throw new AppError(
      409,
      'skill_mutation_already_finished',
      `Skill mutation ${mutationId} already finished with status ${previousResult.status}`,
    )
  }
  const beforeObjects = await listSkillPackageObjects(s3, normalized, skillName)
  const head = await s3.headObject(s3Key)

  if (!head) {
    throw new AppError(404, 'skill_object_not_found', `Skill object not found: ${relKey}`)
  }
  const mutation = {
    mutationId,
    scope: normalized,
    skillName,
    action: 'delete_object' as const,
    actor: context.actor,
    changedKeys: [relKey],
    beforeEtags: etagsByRelativeKey(normalized, beforeObjects),
  }

  await repository.begin(mutation)
  try {
    await s3.deleteObject(s3Key)
  } catch (err) {
    await repository.fail({ ...mutation, error: mutationError(err) })
    throw err
  }
  const afterObjects = await listSkillPackageObjects(s3, normalized, skillName)

  await repository.complete({
    ...mutation,
    status: 'applied',
    recordStatus: afterObjects.length > 0 ? 'active' : 'deleted',
    createdNew: false,
    afterEtags: etagsByRelativeKey(normalized, afterObjects),
  })
  await refreshScopeAfterMutation(normalized)
}

/** Delete every object under skills/<name>/ in one server-side batch (single cache refresh). */
export async function deleteSkillByName(
  scope: string,
  name: string,
  context: SkillMutationContext,
): Promise<DeleteSkillResult> {
  const normalized = normalizeSkillScope(scope)
  const skillName = validateSkillName(name)
  const s3 = requireSkillsStore(normalized)
  const repository = skillMetadataRepository()
  const mutationId = context.mutationId ?? randomUUID()
  const previousResult = await repository.getResult(mutationId)

  if (previousResult) {
    if (previousResult.status !== 'applied') {
      throw new AppError(
        409,
        'skill_mutation_already_finished',
        `Skill mutation ${mutationId} already finished with status ${previousResult.status}`,
      )
    }

    return {
      name: skillName,
      deletedCount: previousResult.changedKeys.length,
      keys: previousResult.changedKeys,
    }
  }
  const prefix = `${normalized}/${SKILL_OBJECT_KEY_PREFIX}${skillName}/`
  const objects = await s3.listUnderPrefix(prefix)

  if (objects.length === 0) {
    throw new AppError(404, 'skill_not_found', `Skill not found: ${skillName}`)
  }

  const mutation = {
    mutationId,
    scope: normalized,
    skillName,
    action: 'delete_skill' as const,
    actor: context.actor,
    changedKeys: objects.map((object) => scopeRelativeKey(normalized, object.key)),
    beforeEtags: etagsByRelativeKey(normalized, objects),
  }

  await repository.begin(mutation)

  const keys: string[] = []

  try {
    for (const obj of objects) {
      await s3.deleteObject(obj.key)
      keys.push(scopeRelativeKey(normalized, obj.key))
    }
  } catch (err) {
    if (keys.length > 0) {
      try {
        await refreshScopeAfterMutation(normalized)
      } catch {
        // Best-effort cache refresh after a partial delete failure.
      }
    }
    const detail =
      keys.length > 0
        ? `Deleted ${String(keys.length)} of ${String(objects.length)} files before failure`
        : 'Failed before deleting any files'
    const message = err instanceof Error ? `${detail}: ${err.message}` : detail

    if (keys.length > 0) {
      const afterObjects = await listSkillPackageObjects(s3, normalized, skillName)

      await repository.complete({
        ...mutation,
        status: 'partial',
        recordStatus: afterObjects.length > 0 ? 'active' : 'deleted',
        createdNew: false,
        changedKeys: keys,
        afterEtags: etagsByRelativeKey(normalized, afterObjects),
        error: message,
      })
    } else {
      await repository.fail({ ...mutation, error: message })
    }
    throw new AppError(500, 'skill_delete_partial', message)
  }

  await repository.complete({
    ...mutation,
    status: 'applied',
    recordStatus: 'deleted',
    createdNew: false,
    afterEtags: {},
  })
  await refreshScopeAfterMutation(normalized)

  return { name: skillName, deletedCount: keys.length, keys }
}
