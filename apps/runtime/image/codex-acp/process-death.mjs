// App Server's death, which a turn waiting for turn/completed races. Then the
// adapter exits after stdout drains, so the failed turn's error still reaches
// OpenAB, which starts a fresh adapter for the next message.
let nuphosCodexDeathReject
const nuphosCodexDeath = new Promise((_, reject) => {
  nuphosCodexDeathReject = reject
})

nuphosCodexDeath.catch(() => {})

function nuphosCodexDied(code, signal) {
  const reason = signal
    ? `process terminated by signal ${signal}`
    : `process exited with code ${code}`

  logger.log(`Codex App Server died: ${reason}`)
  nuphosCodexDeathReject(
    RequestError.internalError(undefined, nuphosProcessDeathMessage('Codex', reason)),
  )
  setImmediate(() => process.stdout.write('', () => process.exit(1)))
}
