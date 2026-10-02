// The gateway keeps the last published state, so a turn that settles without a
// later SDK state change (held-turn cancel, wedged force-cancel) must publish too.
const helper = `
function nuphosSessionState(session) {
    if (session.queryClosed) return "interrupted";
    if ((session.activeTurn && !session.activeTurn.settled) || (session.turnQueue ?? []).some((turn) => !turn.settled))
        return "active";
    if (session.nuphosSdkWedged) return "idle";
    return session.lastSessionState === undefined || session.lastSessionState === "idle" ? "idle" : "active";
}
async function publishNuphosSessionState(agent, sessionId, session) {
    if (agent.sessions[sessionId] !== session) return;
    try {
        await agent.client.sessionUpdate({
            sessionId,
            update: { sessionUpdate: "session_info_update", _meta: {
                "ai.nuphos/sessionState": { state: nuphosSessionState(session) }
            }}
        });
    }
    catch (error) {
        agent.logger.error("Could not publish runtime session state", error);
    }
}
`

function replaceOnce(source, anchor, replacement, what) {
  if (source.split(anchor).length !== 2) throw new Error(`Expected one Claude ${what}.`)
  return source.replace(anchor, () => replacement)
}

export function patchClaudeSessionState(source) {
  const stateAnchor =
    '                                break;\n                            }\n                            case "memory_recall": {'
  source = replaceOnce(
    source,
    stateAnchor,
    `
                                await publishNuphosSessionState(this, params.sessionId, session);
                                if (message.state === "idle") await session.titles.onTurnEnd(session);
${stateAnchor}`,
    'session-state lifecycle handoff',
  )
  source = replaceOnce(
    source,
    '                                    await session.titles.onTurnEnd(session);',
    '                                    // Runtime state is published before optional title enrichment.',
    'turn-end title handoff',
  )
  source = replaceOnce(
    source,
    '                                session.lastSessionState = message.state;',
    '                                session.lastSessionState = message.state;\n                                session.nuphosSdkWedged = false;',
    'SDK session-state record',
  )
  source = replaceOnce(
    source,
    '                    settleActive(turnOutcome(session, "cancelled"));\n                    // The cancelled turn\'s result may never come',
    '                    session.nuphosSdkWedged = true;\n                    settleActive(turnOutcome(session, "cancelled"));\n                    // The cancelled turn\'s result may never come',
    'force-cancel settle',
  )
  source = replaceOnce(
    source,
    '        await this.publishGoalFromPrompt(params.sessionId, firstText, promptUuid);\n        return response;',
    '        void turn.completion.then(() => publishNuphosSessionState(this, params.sessionId, session));\n        await this.publishGoalFromPrompt(params.sessionId, firstText, promptUuid);\n        return response;',
    'prompt turn handoff',
  )
  const publishLoaded =
    '        await publishNuphosSessionState(this, params.sessionId, this.sessions[params.sessionId]);'
  source = replaceOnce(
    source,
    '        await this.replaySessionHistory(params.sessionId);',
    `        await this.replaySessionHistory(params.sessionId);\n${publishLoaded}`,
    'session load',
  )
  source = replaceOnce(
    source,
    '        const result = await this.getOrCreateSession(params);\n        // Needs to happen after we return the session',
    `        const result = await this.getOrCreateSession(params);\n${publishLoaded}\n        // Needs to happen after we return the session`,
    'session resume',
  )
  const closeAnchor = '        session.queryClosed = true;'
  source = replaceOnce(
    source,
    closeAnchor,
    `${closeAnchor}
        const stateSessionId = Object.entries(this.sessions).find(([, value]) => value === session)?.[0];
        if (stateSessionId) void publishNuphosSessionState(this, stateSessionId, session);`,
    'native query teardown',
  )
  return `${helper}\n${source}`
}
