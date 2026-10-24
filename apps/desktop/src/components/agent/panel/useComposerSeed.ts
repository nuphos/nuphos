import { useEffect } from 'react'

import { settleSend } from './composerSend'

import type { SendResult } from './composerSend'
import type { AgentPromptSeed } from './model'
import type { ComposerState } from './useComposerState'

type InsertInto = (text: string, opts?: { appendToEnd?: boolean }) => void

/** Seeds the editor when a row link is "Open in chat"'d, or sends the seed outright. */
export function useComposerSeed(
  state: ComposerState,
  {
    readOnly,
    sendBlocked,
    streaming,
    pendingSeed,
    onSend,
    onSeedConsumed,
    clearDraft,
    insertText,
    insertMention,
  }: {
    readOnly: boolean
    sendBlocked: boolean
    streaming: boolean
    pendingSeed?: AgentPromptSeed | null
    onSend: (text: string, filePaths: string[]) => SendResult
    onSeedConsumed?: () => void
    clearDraft: () => void
    insertText: InsertInto
    insertMention: InsertInto
  },
) {
  useEffect(() => {
    if (!pendingSeed) return
    if (readOnly) return
    if (pendingSeed.autoSend && (streaming || sendBlocked)) return
    if (state.seedAlreadySeen(pendingSeed.nonce)) return
    requestAnimationFrame(() => {
      const seedFiles = pendingSeed.filePaths ?? []
      const addSeedFiles = () => {
        if (seedFiles.length > 0) {
          state.setFilePaths((prev) => Array.from(new Set([...prev, ...seedFiles])))
        }
      }

      if (pendingSeed.autoSend) {
        // A refused auto-send lands in the editor instead, for the user to send
        // once whatever refused it is resolved — never retried on its own.
        settleSend(onSend(pendingSeed.text, seedFiles), {
          accepted: clearDraft,
          refused: () => {
            addSeedFiles()
            insertText(pendingSeed.text, { appendToEnd: true })
          },
        })
        onSeedConsumed?.()

        return
      }
      if (pendingSeed.replace) {
        state.clearEditor()
      }
      addSeedFiles()
      if (pendingSeed.text) {
        if (pendingSeed.mode === 'mention') {
          insertMention(pendingSeed.text, { appendToEnd: true })
        } else {
          insertText(pendingSeed.text, { appendToEnd: true })
        }
      }
      onSeedConsumed?.()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, readOnly, streaming, sendBlocked])
}
