export type BoxJoin = { token: string; expiresAt: string; apiUrl: string | null }

/** The two commands that make a machine one of your computers, run on the machine itself. */
export function joinCommand(join: BoxJoin): string {
  // Nuphos Cloud is the CLI's default; only another deployment (self-hosted, dev) names itself.
  const env = [
    join.apiUrl && join.apiUrl !== 'https://api.nuphos.ai' ? `NUPHOS_API_URL=${join.apiUrl}` : '',
    `NUPHOS_JOIN_TOKEN=${join.token}`,
  ]
    .filter(Boolean)
    .join(' ')

  // By its install path: on a fresh machine ~/.local/bin is often not on PATH yet.
  return `curl -fsSL https://nuphos.ai/install | sh\n${env} ~/.local/bin/nuphos agent`
}
