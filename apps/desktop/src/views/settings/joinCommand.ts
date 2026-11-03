export type BoxJoin = { token: string; expiresAt: string; apiUrl: string | null }

const INSTALL = 'curl -fsSL https://nuphos.ai/install | sh'
// user@host, host or an ~/.ssh/config alias: one shell word that ssh cannot read as an option.
const SSH_TARGET = /^\w[\w.@-]*$/

/** What turns a machine into one of your computers: run on it, or sent to it over SSH when a target is given. */
export function joinCommand(join: BoxJoin, sshTarget = ''): string {
  // Nuphos Cloud is the CLI's default; only another deployment (self-hosted, dev) names itself.
  const env = [
    join.apiUrl && join.apiUrl !== 'https://api.nuphos.ai' ? `NUPHOS_API_URL=${join.apiUrl}` : '',
    `NUPHOS_JOIN_TOKEN=${join.token}`,
  ]
    .filter(Boolean)
    .join(' ')
  const target = sshTarget.trim()

  if (!SSH_TARGET.test(target)) return `${INSTALL}\n${env} nuphos agent`

  // The installer's default directory is not on a non-interactive shell's PATH, and the agent
  // keeps running after the SSH session ends; its own output goes to a log so ssh can return.
  return `ssh ${target} '${INSTALL} && (${env} nohup ~/.local/bin/nuphos agent >~/.nuphos-agent.log 2>&1 </dev/null &)'`
}
