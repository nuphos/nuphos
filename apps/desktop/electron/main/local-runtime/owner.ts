import crypto from 'node:crypto'

const CLOUD_ORIGIN = 'https://api.nuphos.ai'

/**
 * The local runtime's owner: whose agents, agent credentials, workspaces and
 * instances it keeps, under `users/<owner>`. A user on Nuphos Cloud keeps the
 * bare id, as before. On any other backend a digest of its full origin
 * (scheme, host and port) is part of the owner, so the same user id on two
 * backends never shares one local agent environment.
 */
export function runtimeOwner(subject: string, api: string): string {
  const { origin } = new URL(api)

  if (origin === CLOUD_ORIGIN) return subject
  const backend = crypto.createHash('sha256').update(origin).digest('hex').slice(0, 16)

  return `${subject}@${backend}`
}
