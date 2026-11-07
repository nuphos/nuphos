import type { AgentMessageMention } from '../../../api/agent-types'

/**
 * Whether a send took ownership of the draft: true once it is a message, a
 * queued entry or an accepted dispatch, and false on every refusal before that
 * (no runtime, a read-only tab, an upload in flight). Most sends answer at
 * once; a first send on a just-started runtime answers once it is listed.
 */
export type SendResult = Promise<boolean>

/** What a send carries besides its text: the teammates its chips mention. */
export type ComposerSend = (
  text: string,
  filePaths: string[],
  mentions?: AgentMessageMention[],
) => SendResult

/**
 * Hands a draft to `send` and clears the composer only once the send owns it.
 * A refusal leaves the draft where it was. A late acceptance clears only if the
 * draft is still the one that was sent, so newer typing survives. While the
 * answer is pending, further submits are held off, so one draft cannot go out
 * twice. Nothing is retried.
 */
export function submitDraft(
  send: () => SendResult,
  {
    pending,
    clear,
    unchanged,
  }: {
    pending: { current: boolean }
    clear: () => void
    /** Whether the composer still holds the draft that was sent. */
    unchanged: () => boolean
  },
): void {
  if (pending.current) return
  pending.current = true
  send()
    .then((accepted) => {
      if (accepted && unchanged()) clear()
    })
    .catch(() => {
      // The sender reports its own failures; the draft simply stays.
    })
    .finally(() => {
      pending.current = false
    })
}

/** Runs `accepted` or `refused` once `result` settles; a failed send counts as refused. */
export function settleSend(
  result: SendResult,
  { accepted, refused }: { accepted?: () => void; refused?: () => void },
): void {
  void result.then(
    (ok) => (ok ? accepted : refused)?.(),
    () => refused?.(),
  )
}

/**
 * Sends and reports the same result back, offering an invite to the mentioned
 * teammates only for a message that went out. On a refused send the draft is
 * still in the composer and nobody has been addressed yet, so there is nothing
 * to invite them to.
 */
export function sendWithMentionInvites(
  send: ComposerSend,
  text: string,
  filePaths: string[],
  mentions: AgentMessageMention[],
  offer: (ids: string[]) => void,
): SendResult {
  const result = send(text, filePaths, mentions)

  settleSend(result, { accepted: () => offer(mentions.map((mention) => mention.id)) })

  return result
}

/** The keypress an editor saw, as far as sending is concerned. */
export type SendKey = {
  key: string
  shiftKey: boolean
  /** An IME is mid-composition: its Enter confirms a candidate, it does not send. */
  isComposing?: boolean
  /** The legacy IME signal, still sent by some input methods (229). */
  keyCode?: number
}

/** Whether this keypress sends the draft; never mid-composition, never read-only. */
export function isSendEnter(
  key: SendKey,
  { composing, readOnly }: { composing: boolean; readOnly: boolean },
): boolean {
  return (
    key.key === 'Enter' &&
    !key.shiftKey &&
    !readOnly &&
    !composing &&
    !key.isComposing &&
    key.keyCode !== 229
  )
}
