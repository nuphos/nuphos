// Turns the fixture refuses, worded as OpenAB reports Claude Code's refusals.
export function refuse(text, outOfUsage) {
  // #3160: a conversation too long for the model, on any agent.
  // #3401: Claude Code unable to reach its API, through a proxy or VPN in the way.
  const reason = text.includes('E2E_TOO_LONG')
    ? 'Prompt is too long'
    : text.includes('E2E_API_UNREACHABLE')
      ? 'API Error: Unable to connect to API (EPROTO)'
      : outOfUsage && 'You’ve hit your usage limit'

  if (reason) throw Object.assign(new Error(`Internal error: ${reason}`), { code: -32603 })
}
