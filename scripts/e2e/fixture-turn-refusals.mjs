import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** #3926: Claude Code's refusal for an account Anthropic holds for verification, as production logged it. */
export const VERIFICATION_HOLD =
  "API Error: Your account can't receive replies from Claude right now. You can find the next step in the Anthropic Verification Portal: https://portal.anthropic.com/verify?org=00000000-0000-4000-8000-000000000000"

// Turns the fixture refuses, worded as OpenAB reports Claude Code's refusals.
import { existsSync } from 'node:fs'

export function refuse(text, outOfUsage) {
  // While a scenario holds the account, a new Bot's setup turn is refused for verification.
  if (
    text.includes('The person just created you') &&
    existsSync(join(dirname(process.env.E2E_ACP_LOG), 'verification-hold'))
  )
    throw Object.assign(
      new Error(`Internal error: ${VERIFICATION_HOLD}\n> {"errorKind":"verification_required"}`),
      { code: -32603 },
    )
  // A computer's own Codex, a broken npm install: codex-acp's startup error, its CLI's stderr.
  if (
    text.includes('E2E_CODEX_BROKEN') ||
    (text.includes('The person just created you') &&
      existsSync(`${process.env.E2E_ACP_LOG}.codex-broken-onboarding`))
  )
    throw Object.assign(
      new Error(
        'Codex process has exited with code 1:\nError: spawn /Users/e2e/.npm-global/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex ENOENT',
      ),
      { code: 1001 },
    )
  // #3160: a conversation too long for the model, on any agent.
  // #3401: Claude Code unable to reach its API, through a proxy or VPN in the way.
  const reason = text.includes('E2E_TOO_LONG')
    ? 'Prompt is too long'
    : text.includes('E2E_API_UNREACHABLE')
      ? 'API Error: Unable to connect to API (EPROTO)'
      : outOfUsage && 'You’ve hit your usage limit'

  if (reason) throw Object.assign(new Error(`Internal error: ${reason}`), { code: -32603 })
}
