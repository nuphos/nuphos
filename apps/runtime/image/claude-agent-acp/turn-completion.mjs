// A stamped result identifies the native cycle that actually answered a steer.
// Older adapters wait for an unkeyed idle instead, which can be swallowed by
// trailing-idle debt from earlier cycles. Keep that fallback only for results
// without a matching identity; an interrupted/pre-steer result is never enough.
//
// That unkeyed idle is shared: a task-notification followup the CLI runs right
// after the steered cycle, with no idle between them, owes a trailer for the
// same single idle. Settle a steered turn whose answer is in before paying debt,
// as upstream 0.89.1 does, or the debt swallows the only idle and the prompt
// never completes. An answer only counts once it follows the steer's echo.
//
// A prompt sent while Claude Code runs a turn of its own (a background task
// finished) is folded into that turn. Its result keeps the task-notification
// origin but names the prompt, so it is the prompt's answer, as upstream
// 0.109 treats it; skipping it leaves the prompt open until a timeout.
export function patchClaudeTurnCompletion(source) {
  const patches = [
    [
      'const isAutonomousResult = message.origin != null && AUTONOMOUS_RESULT_ORIGINS.has(message.origin.kind);',
      `const isAutonomousResult = message.origin != null && AUTONOMOUS_RESULT_ORIGINS.has(message.origin.kind) &&
                            ![message.user_message_uuid, ...(message.user_message_uuids ?? [])].some((uuid) => {
                                const turn = typeof uuid === "string" ? findUnsettledTurn(uuid) : undefined;
                                return turn !== undefined && !isHeldOpen(turn);
                            });`,
    ],
    [
      '(turnInFlight.steeredEchoes ??= new Set()).add(steeredUuid);',
      '(turnInFlight.steeredEchoes ??= new Set()).add(steeredUuid);\n        turnInFlight.nuphosLatestSteerUuid = steeredUuid;',
    ],
    [
      '                                ensureActiveTurn(message.user_message_uuid);',
      `                                ensureActiveTurn(message.user_message_uuid);
                                const answeredTurn = session.activeTurn;
                                if (isSteering(answeredTurn) &&
                                    typeof message.user_message_uuid === "string" &&
                                    message.user_message_uuid === answeredTurn.nuphosLatestSteerUuid) {
                                    // This result belongs to the latest injected command, not
                                    // the cycle it interrupted. Let the normal result handler
                                    // settle it (including errors, usage, and subagent holds).
                                    // Clear synchronously: a newer steer arriving during an
                                    // await below reinstates the hold with its own identity.
                                    answeredTurn.steeredEchoes = undefined;
                                    answeredTurn.steeredSettle = undefined;
                                    answeredTurn.nuphosLatestSteerUuid = undefined;
                                }`,
    ],
    [
      '                                    session.activeTurn.steeredEchoes.delete(message.uuid);',
      `                                    if (session.activeTurn.steeredEchoes.delete(message.uuid))
                                        session.activeTurn.nuphosSteerAwaitingResult = true;`,
    ],
    [
      '                session.activeTurn.steeredSettle = outcome;',
      '                session.activeTurn.steeredSettle = outcome;\n                session.activeTurn.nuphosSteerAwaitingResult = false;',
    ],
    [
      '                                    else if (session.owedTrailingIdles > 0) {',
      `                                    else if (isSteering(session.activeTurn) &&
                                        session.activeTurn.steeredEchoes.size === 0 &&
                                        session.activeTurn.steeredSettle !== undefined &&
                                        !session.activeTurn.nuphosSteerAwaitingResult) {
                                        const steered = session.activeTurn;
                                        steered.deferredSettle = steered.steeredSettle;
                                        steered.steeredEchoes = undefined;
                                        steered.steeredSettle = undefined;
                                        settleDeferredIfDrained();
                                    }
                                    else if (session.owedTrailingIdles > 0) {`,
    ],
  ]
  for (const [anchor, replacement] of patches) {
    if (source.split(anchor).length !== 2)
      throw new Error('Expected one Claude steering completion handoff.')
    source = source.replace(anchor, replacement)
  }
  return source
}
