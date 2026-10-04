// A stamped result identifies the native cycle that actually answered a steer.
// Older adapters wait for an unkeyed idle instead, which can be swallowed by
// trailing-idle debt from earlier cycles. Keep that fallback only for results
// without a matching identity; an interrupted/pre-steer result is never enough.
export function patchClaudeTurnCompletion(source) {
  const patches = [
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
  ]
  for (const [anchor, replacement] of patches) {
    if (source.split(anchor).length !== 2)
      throw new Error('Expected one Claude steering completion handoff.')
    source = source.replace(anchor, replacement)
  }
  return source
}
