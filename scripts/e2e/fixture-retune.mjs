// E2E_RETUNE: start a thread here, then change its model with update_thread (#3699).
const threadIdOf = (message) =>
  /threadId[\\"]*:[\\"]*([0-9a-f-]{36})/.exec(JSON.stringify(message))?.[1]

export async function retune({ call, step, log, sessionId, child }) {
  const threadId = threadIdOf(
    await step(sessionId, 'create_thread', {
      label: 'Start a thread here',
      title: 'E2E retune',
      prompt: `${child} E2E_DELIVERY:retune-child`,
    }),
  )

  // A session answers no settings change while its first turn runs.
  await new Promise((resolve) => setTimeout(resolve, 4_000))
  const changed = await call(sessionId, 'update_thread', {
    label: 'Change the thread’s model',
    threadId,
    model: 'fixture-small',
  })

  log({
    sessionId,
    event: 'retuned',
    detail: JSON.stringify({ threadId, error: changed.error ?? changed.result?.isError ?? false }),
  })
}
