import { AppError } from '@/lib/errors'

import type { TailscaleSandboxAccess } from '@/models'
import type { ObjectId } from 'mongodb'

// Matches the tag grammar the tailscale-dialer already enforces, so both planes
// accept exactly the same set of tags.
const TAG_PATTERN = /^tag:[a-z0-9][a-z0-9-]{0,62}$/

export const TAILNET_AUTH_KEY_TTL_SECONDS = 300

export function assertTailnetTag(tag: string): string {
  if (!TAG_PATTERN.test(tag)) {
    throw new AppError(
      422,
      'tailscale_tag_invalid',
      'The tailnet tag must look like tag:name (lowercase letters, digits and dashes).',
    )
  }

  return tag
}

/**
 * Sandbox node names are what ties a line in the customer's Tailscale audit log
 * back to a Nuphos conversation, so the session id has to survive into the
 * hostname. Tailscale rejects anything outside the DNS-label grammar, hence the
 * truncated hex rather than the raw ids.
 */
export function tailnetSandboxHostname(teamId: ObjectId, sessionId: string): string {
  const session =
    sessionId
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(-8) || 'session'

  return `nuphos-${teamId.toHexString().slice(-6)}-${session}`
}

export function requireTailnetSandboxTag(access: TailscaleSandboxAccess | undefined): string {
  if (!access?.enabled) {
    throw new AppError(
      403,
      'tailscale_sandbox_access_disabled',
      'This Tailscale binding is not enabled for private network access from agent sandboxes.',
    )
  }

  return assertTailnetTag(access.tag)
}

export type TailnetAclSnippetOptions = {
  tag: string
  targetTag: string
  sshUsers: string[]
  /** Tag of the customer's session recorder. Omitted means no recording clause. */
  recorderTag?: string
}

/**
 * The copy-pasteable half of the customer's side of the setup. Deliberately
 * emitted as text for them to review and commit themselves: Nuphos never writes
 * to the tailnet policy file, because "you own the authorization boundary" stops
 * being true the moment we do.
 *
 * The ssh rule is `accept`, never `check`. Tailscale rejects `check` outright
 * when `src` is a tag — the action needs a user identity to attribute the
 * browser approval to, and a tagged sandbox node has none. Verified against the
 * live API: `[ssh] "check" action does not support tags in src`. The per-session
 * human gate therefore lives in Nuphos's own approval flow, and the customer's
 * enforceable control is session recording, which fails the connection closed
 * when the recorder is unreachable.
 */
export function renderTailnetAclSnippet(options: TailnetAclSnippetOptions): string {
  const tag = assertTailnetTag(options.tag)
  const targetTag = assertTailnetTag(options.targetTag)
  const recorderTag = options.recorderTag ? assertTailnetTag(options.recorderTag) : null
  const users = options.sshUsers.length > 0 ? options.sshUsers : ['autogroup:nonroot']
  const list = (values: string[]) => values.map((value) => JSON.stringify(value)).join(', ')

  const recording = recorderTag
    ? `,
      // Every session is recorded, and the connection is refused outright if
      // the recorder is unreachable. The recorder is yours — the recording
      // never leaves your network.
      "recorder": [${JSON.stringify(recorderTag)}],
      "enforceRecorder": true`
    : ''

  return `// Nuphos private network access — review before applying.
// Nuphos owns nothing outside these three blocks; delete them to revoke instantly.
{
  "tagOwners": {
    // Replace group:sre with whoever should be able to grant this.
    ${JSON.stringify(tag)}: ["group:sre"]
  },

  "grants": [
    {
      "src": [${JSON.stringify(tag)}],
      "dst": [${JSON.stringify(targetTag)}],
      "ip": ["tcp:22"]
    }
  ],

  "ssh": [
    {
      // Must be "accept": Tailscale rejects "check" when src is a tag, because
      // there is no user identity to send through the approval prompt.
      "action": "accept",
      "src": [${JSON.stringify(tag)}],
      "dst": [${JSON.stringify(targetTag)}],
      "users": [${list(users)}]${recording}
    }
  ]
}
`
}
