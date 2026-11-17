// Turns the fixture refuses, worded as OpenAB reports Claude Code's refusals.
export function refuse(text, outOfUsage) {
  // #3160: a conversation too long for the model, on any agent.
  const reason = text.includes('E2E_TOO_LONG')
    ? 'Prompt is too long'
    : outOfUsage && 'You’ve hit your usage limit'

  if (reason) throw Object.assign(new Error(`Internal error: ${reason}`), { code: -32603 })
}
