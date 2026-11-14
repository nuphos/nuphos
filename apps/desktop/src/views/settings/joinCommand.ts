export type BoxJoin = { token: string; expiresAt: string; apiUrl: string | null }

/** The command that makes a machine one of your computers, run on the machine itself. */
export function joinCommand(join: BoxJoin): string {
  // Nuphos Cloud is the CLI's default; only another deployment (self-hosted, dev) names itself.
  const env = [
    join.apiUrl && join.apiUrl !== 'https://api.nuphos.ai' ? `NUPHOS_API_URL=${join.apiUrl}` : '',
    `NUPHOS_JOIN_TOKEN=${join.token}`,
  ]
    .filter(Boolean)
    .join(' ')

  // The installer starts `nuphos agent` when given a token, so a PATH without it does not matter.
  return `curl -fsSL https://nuphos.ai/install | ${env} sh`
}
