/**
 * Operator commands for a self-hosted backend, run inside its container with the
 * backend's own environment:
 *
 *   nuphos-admin bootstrap --email <email> --team <name>
 *   nuphos-admin sign-in-code --email <email>
 *   nuphos-admin join-token --team <teamId> [--label <label>]
 */
import { config } from '@/config'
import { boxBackendUrl } from '@/lib/agent/devices/box-instabox-client'
import { issueDeviceJoinToken } from '@/lib/agent/devices/join-tokens'
import { closeDb, connectDb } from '@/lib/db'
import { issueEmailOtpCode } from '@/lib/email-otp'
import {
  createTeamForUser,
  getMyTeams,
  getTeamsByIds,
  signInWithVerifiedEmail,
} from '@/lib/identity'

const USAGE = `usage:
  nuphos-admin bootstrap --email <email> --team <name>
      Creates the user and a team they administer (or reuses both), prints the
      ATLAS_ADMIN_TEAM_ID line and a sign-in code.
  nuphos-admin sign-in-code --email <email>
      Prints a 10-minute sign-in code for a server that does not send email.
  nuphos-admin join-token --team <teamId> [--label <label>]
      Prints a one-time token that joins a machine as the team owner's computer.`

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)

  return i === -1 ? undefined : process.argv[i + 1]
}

function need(name: string): string {
  const value = flag(name)?.trim()

  if (!value) throw new Error(`--${name} is required\n\n${USAGE}`)

  return value
}

async function signInCode(email: string): Promise<string> {
  return `Sign-in code for ${email} (valid 10 minutes): ${await issueEmailOtpCode(email)}
In Nuphos Desktop choose "Continue with email", enter ${email}, then this code.`
}

async function bootstrap(): Promise<string> {
  const email = need('email')
  const name = need('team')
  const user = await signInWithVerifiedEmail(email)
  const team =
    (await getMyTeams(user.id)).find((t) => t.name === name && t.role === 'ADMINISTRATOR') ??
    (await createTeamForUser(user.id, name))
  const admin =
    config.admin.teamId === team.id
      ? 'It is already the admin team.'
      : `To make it the admin team, set this in the backend environment and restart:\n\n  ATLAS_ADMIN_TEAM_ID=${team.id}`

  return `User ${user.email} (${user.id}) administers team "${team.name}" (${team.id}).
${admin}

${await signInCode(user.email)}`
}

async function joinToken(): Promise<string> {
  const [team] = await getTeamsByIds([need('team')])

  if (!team) throw new Error('Team not found')
  const label = flag('label')
  const { token, expiresAt } = await issueDeviceJoinToken(team.ownerID, label ? { label } : {})
  const api = boxBackendUrl() ?? config.auth.publicBaseUrl

  return `Join token (one use, expires ${expiresAt.toISOString()}):

  ${token}

On the machine (keep NUPHOS_API_URL set for later runs, e.g. in its systemd unit):

  curl -fsSL https://nuphos.ai/install | sh
  NUPHOS_API_URL=${api} nuphos agent --join -    # paste the token`
}

const commands: Record<string, () => Promise<string>> = {
  bootstrap,
  'sign-in-code': () => signInCode(need('email')),
  'join-token': joinToken,
}
const run = commands[process.argv[2] ?? '']

if (!run) {
  console.error(USAGE)
  process.exit(2)
}

await connectDb()
try {
  console.log(await run())
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
