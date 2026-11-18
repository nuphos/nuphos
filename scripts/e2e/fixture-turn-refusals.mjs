// Turns the fixture refuses, worded as OpenAB reports Claude Code's refusals.
export function refuse(text, outOfUsage) {
  // A computer's own Codex, a broken npm install: codex-acp's startup error, its CLI's stderr.
  if (text.includes('E2E_CODEX_BROKEN'))
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
