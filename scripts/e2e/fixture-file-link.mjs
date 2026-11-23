// E2E_FILE_LINK: the reply links a file the agent's workspace does not have, so Files
// cannot load it and offers to open the chat that linked it (#4301).
export function fileLink({ send, sessionId, text }) {
  if (!text.includes('E2E_FILE_LINK')) return
  const link = '[missing-report.md](/tmp/nuphos-e2e-missing/missing-report.md) '

  send({
    method: 'session/update',
    params: {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: link } },
    },
  })
}
