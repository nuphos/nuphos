// OpenAB renders no form elicitations, so the adapter answers request_user_input
// with no answers. Ask through Nuphos instead; see native-question.mjs, which is
// inlined beside this patch.
const SERVERS = '    const requestedMcpServers = request.mcpServers ?? [];\n'
const USER_INPUT =
  '  async handleUserInput(params) {\n    if (!clientSupportsFormElicitation(this.clientCapabilities)) {\n      return { answers: {} };'

export function patchCodexUserInput(source) {
  // Both the new/resume and the load paths read the session's servers.
  if (source.split(SERVERS).length !== 3 || source.split(USER_INPUT).length !== 2)
    throw new Error('Expected Codex session server and user input handoffs')

  return source
    .replaceAll(SERVERS, `${SERVERS}    nuphosRememberDecisionServer(request.mcpServers);\n`)
    .replace(
      USER_INPUT,
      USER_INPUT.replace('return { answers: {} };', 'return await nuphosAskCodexQuestion(params);'),
    )
}
