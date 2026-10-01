export type ComposerTextState = {
  /** The editor contains at least one character. Controls visual emptiness —
   *  even a space means the user has started typing, so the placeholder leaves. */
  hasContent: boolean
  /** The editor contains something meaningful to send. Whitespace alone is not
   *  a message, so the send action remains disabled. */
  canSendText: boolean
}

/**
 * A contenteditable composer has two different kinds of "empty": visual and
 * semantic. Keeping them separate prevents the placeholder and send button from
 * disagreeing about whitespace.
 */
export function composerTextState(text: string): ComposerTextState {
  return {
    hasContent: text.length > 0,
    canSendText: text.trim().length > 0,
  }
}
