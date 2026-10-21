const CLOUD_ORIGIN = 'https://api.nuphos.ai'

/**
 * The local runtime's owner: whose agents, agent credentials, workspaces and
 * instances it keeps, under `users/<owner>`. A user on Nuphos Cloud keeps the
 * bare id, as before. On any other backend its host is part of the owner, so
 * the same user id on two backends never shares one local agent environment.
 */
export function runtimeOwner(subject: string, api: string): string {
  const url = new URL(api)

  if (url.origin === CLOUD_ORIGIN) return subject

  return `${subject}@${url.host.replace(/[^\w.-]/gu, '_')}`
}
