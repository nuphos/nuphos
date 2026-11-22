// OpenAB renders no form elicitations, so the adapter would disable
// AskUserQuestion. Keep the tool where the session can ask through Nuphos, and
// ask there instead; see native-question.mjs, which is inlined beside this patch.
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Expected one Claude AskUserQuestion anchor: ${anchor.slice(0, 80)}`)

  return source.replace(anchor, () => replacement)
}

export function patchClaudeAskUserQuestion(source) {
  const disallowed =
    '        const disallowedTools = elicitationSupport.form ? [] : ["AskUserQuestion"];'
  const elicited =
    '            if (toolName === \"AskUserQuestion\" && this.clientCapabilities?.elicitation?.form) {\n'
  const servers = '        const mcpServers = {};\n'
  let patched = replaceOnce(
    source,
    disallowed,
    // Workflow, ScheduleWakeup and ReportFindings serve Claude Code's own CLI (opt-in
    // workflows, /loop pacing, the code-review panel); Nuphos renders none of them, and
    // their schemas cost about 4.6k input tokens on every request.
    '        const disallowedTools = [...(elicitationSupport.form || nuphosOffersDecisions(params.mcpServers) ? [] : ["AskUserQuestion"]), "Workflow", "ScheduleWakeup", "ReportFindings"];',
  )

  patched = replaceOnce(
    patched,
    elicited,
    `            if (toolName === "AskUserQuestion" && !this.clientCapabilities?.elicitation?.form) {
                await this.ensureToolCallEmitted(sessionId, toolName, toolUseID, toolInput, parentToolUseId, signal, permissionSessionId);
                return nuphosAskClaudeQuestion(toolInput);
            }
${elicited}`,
  )

  return replaceOnce(
    patched,
    servers,
    `${servers}        nuphosRememberDecisionServer(params.mcpServers);\n`,
  )
}
