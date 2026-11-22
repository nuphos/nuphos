// Turns the fixture refuses, worded as OpenAB reports Claude Code's refusals.
import { existsSync, writeFileSync } from 'node:fs'

/** #3926: Claude Code's refusal for an account Anthropic holds for verification, as production logged it. */
export const VERIFICATION_HOLD =
  "API Error: Your account can't receive replies from Claude right now. You can find the next step in the Anthropic Verification Portal: https://portal.anthropic.com/verify?org=00000000-0000-4000-8000-000000000000"

export function refuse(text, outOfUsage) {
  // While a scenario holds the account, a new Bot's setup turn is refused for verification.
  if (
    text.includes('The person just created you') &&
    existsSync(`${process.env.E2E_ACP_LOG}.verification-hold`)
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
  // A turn that cannot reach the API once; Nuphos resends it with the next turn, which goes through.
  const once = `${process.env.E2E_ACP_LOG}.failed-once`

  if (text.includes('E2E_FAIL_ONCE') && !existsSync(once)) {
    writeFileSync(once, '')
    throw Object.assign(new Error('Internal error: API Error: Unable to connect to API (EPROTO)'), {
      code: -32603,
    })
  }
  // #3160: a conversation too long for the model, on any agent.
  // #3401: Claude Code unable to reach its API, through a proxy or VPN in the way.
  // #4037: a model the endpoint lacks, on the first agent only so the turn goes on after fallback.
  const reason = text.includes('E2E_TOO_LONG')
    ? 'Prompt is too long'
    : text.includes('E2E_API_UNREACHABLE')
      ? 'API Error: Unable to connect to API (EPROTO)'
      : text.includes('E2E_MODEL_NOT_FOUND') && process.env.E2E_AGENT !== 'second'
        ? 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-e2e-retired"}}'
        : outOfUsage && 'You’ve hit your usage limit'

  if (reason) throw Object.assign(new Error(`Internal error: ${reason}`), { code: -32603 })
}
