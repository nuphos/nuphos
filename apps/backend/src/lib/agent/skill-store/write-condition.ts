/** Write only if the object still has this ETag, or only if it does not exist yet. */
export type WriteCondition = { ifMatch: string } | { ifNoneMatch: '*' }

/** A conditional write found the object changed, created or removed since it was read. */
export class PreconditionFailedError extends Error {
  constructor(readonly key: string) {
    super(`${key} changed since it was read`)
  }
}

export function conditionHeaders(condition: WriteCondition | undefined) {
  if (!condition) return {}

  // Quoted, as ETags travel in HTTP; some S3-compatible stores reject them bare.
  return 'ifMatch' in condition ? { IfMatch: `"${condition.ifMatch}"` } : { IfNoneMatch: '*' }
}

/**
 * The error to throw for a failed store write: a conditional write answered 412,
 * 409 (a concurrent conditional write won) or 404 (the object is gone) changed underneath.
 */
export function conditionalWriteError(
  err: unknown,
  key: string,
  condition: WriteCondition | undefined,
): unknown {
  const name = (err as { name?: string }).name
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  const changed =
    name === 'PreconditionFailed' ||
    name === 'ConditionalRequestConflict' ||
    name === 'NoSuchKey' ||
    status === 412 ||
    status === 409 ||
    status === 404

  return condition && changed ? new PreconditionFailedError(key) : err
}
