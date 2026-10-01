import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'

import { skillMetadataRepository } from '../metadata'
import { normalizeSkillScope, skillObjectKey } from '../scope'

import {
  assertSkillNameNotBuiltinOverlay,
  etagsByRelativeKey,
  listSkillPackageObjects,
  mutationError,
  refreshScopeAfterMutation,
  requireSkillsStore,
  skillNameFromObjectKey,
  toApiObject,
  validateSkillObjectKey,
} from './shared'
import { MAX_SKILL_UPLOAD_BYTES } from './types'

import type { SkillMutationAction } from '../metadata'
import type { SkillMutationContext, SkillObject, SkillObjectWrite } from './types'

export async function putSkillObject(
  scope: string,
  key: string,
  body: Buffer,
  contentType: string | null | undefined,
  context: SkillMutationContext,
): Promise<SkillObject> {
  const [saved] = await putSkillObjects(scope, [{ key, body, contentType }], context)

  if (!saved) throw new Error('Skill object mutation completed without an object')

  return saved
}

type PriorObjectState = {
  body: Buffer
  contentType: string | null
}

/**
 * Atomically-at-the-package-boundary write one or more objects for one skill.
 * S3 owns bytes; Mongo owns provenance. The intent lands before the first S3
 * write, and the service restores prior bytes when a later write fails.
 */
export async function putSkillObjects(
  scope: string,
  writes: SkillObjectWrite[],
  context: SkillMutationContext,
): Promise<SkillObject[]> {
  if (writes.length === 0) {
    throw new AppError(400, 'invalid_input', 'At least one skill object is required')
  }
  const normalized = normalizeSkillScope(scope)
  const normalizedWrites = writes.map((write) => {
    if (write.body.byteLength > MAX_SKILL_UPLOAD_BYTES) {
      throw new AppError(
        413,
        'skill_upload_too_large',
        `Upload exceeds ${String(MAX_SKILL_UPLOAD_BYTES)} bytes`,
      )
    }
    const key = validateSkillObjectKey(write.key)
    const skillName = skillNameFromObjectKey(key)

    if (!skillName) {
      throw new AppError(400, 'invalid_input', `key must be skills/<name>/... (${key})`)
    }

    return { ...write, key, skillName }
  })
  const skillNames = new Set(normalizedWrites.map((write) => write.skillName))

  if (skillNames.size !== 1) {
    throw new AppError(400, 'invalid_input', 'A skill mutation may only change one skill package')
  }
  if (new Set(normalizedWrites.map((write) => write.key)).size !== normalizedWrites.length) {
    throw new AppError(400, 'invalid_input', 'Duplicate object keys in one skill mutation')
  }
  const skillName = normalizedWrites[0]!.skillName

  await assertSkillNameNotBuiltinOverlay(skillName)

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
    const replayed: SkillObject[] = []

    for (const write of normalizedWrites) {
      const head = await s3.headObject(skillObjectKey(normalized, write.key))

      if (!head) {
        throw new AppError(
          409,
          'skill_mutation_state_changed',
          `Skill mutation ${mutationId} was already applied but ${write.key} no longer exists`,
        )
      }
      replayed.push(
        toApiObject(normalized, {
          key: skillObjectKey(normalized, write.key),
          size: head.size,
          etag: head.etag,
          lastModified: head.lastModified,
        }),
      )
    }

    return replayed
  }

  const beforeObjects = await listSkillPackageObjects(s3, normalized, skillName)
  const action: SkillMutationAction = beforeObjects.length === 0 ? 'create' : 'update'
  const changedKeys = normalizedWrites.map((write) => write.key)
  const mutation = {
    mutationId,
    scope: normalized,
    skillName,
    action,
    actor: context.actor,
    changedKeys,
    beforeEtags: etagsByRelativeKey(normalized, beforeObjects),
  }

  await repository.begin(mutation)

  const prior = new Map<string, PriorObjectState | null>()

  try {
    for (const write of normalizedWrites) {
      const s3Key = skillObjectKey(normalized, write.key)
      const head = await s3.headObject(s3Key)

      prior.set(
        write.key,
        head ? { body: await s3.getObjectBody(s3Key), contentType: head.contentType } : null,
      )
    }
  } catch (err) {
    await repository.fail({ ...mutation, error: mutationError(err) })
    throw err
  }

  const saved: SkillObject[] = []

  try {
    for (const write of normalizedWrites) {
      const etag = await s3.putObject(
        skillObjectKey(normalized, write.key),
        write.body,
        write.contentType,
      )

      saved.push({
        key: write.key,
        size: write.body.byteLength,
        etag,
        lastModified: new Date().toISOString(),
      })
    }
  } catch (err) {
    const rollbackErrors: string[] = []

    for (const savedObject of [...saved].reverse()) {
      const old = prior.get(savedObject.key)

      try {
        const s3Key = skillObjectKey(normalized, savedObject.key)

        if (old) await s3.putObject(s3Key, old.body, old.contentType)
        else await s3.deleteObject(s3Key)
      } catch (rollbackErr) {
        rollbackErrors.push(`${savedObject.key}: ${mutationError(rollbackErr)}`)
      }
    }
    await refreshScopeAfterMutation(normalized)
    if (rollbackErrors.length === 0) {
      await repository.fail({ ...mutation, error: mutationError(err) })
      throw err
    }

    const afterObjects = await listSkillPackageObjects(s3, normalized, skillName)
    const error = `${mutationError(err)}; rollback failed: ${rollbackErrors.join('; ')}`

    await repository.complete({
      ...mutation,
      status: 'partial',
      recordStatus: afterObjects.length > 0 ? 'active' : 'deleted',
      createdNew: beforeObjects.length === 0,
      afterEtags: etagsByRelativeKey(normalized, afterObjects),
      error,
    })
    throw new AppError(500, 'skill_write_partial', error)
  }

  const afterObjects = await listSkillPackageObjects(s3, normalized, skillName)

  await repository.complete({
    ...mutation,
    status: 'applied',
    recordStatus: 'active',
    createdNew: beforeObjects.length === 0,
    afterEtags: etagsByRelativeKey(normalized, afterObjects),
  })
  await refreshScopeAfterMutation(normalized)

  return saved
}
