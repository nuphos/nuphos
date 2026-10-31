import { t } from '../../../i18n/index.ts'

import { askState } from './agentSignInModel.ts'
import { waitingMessages } from './queuedAutoSend.ts'

import type { Tab } from './model.ts'
import type { AgentSignInRequest } from '../../../api/agent-types.ts'

/** What this person's queued messages wait for when they asked someone to sign the agent in. */
export function signInHoldNotice(
  ask: AgentSignInRequest | undefined,
  viewerId: string | undefined,
  tab: Pick<Tab, 'messages' | 'queued'> | null | undefined,
  now = Date.now(),
): { status: 'pending'; text: string } | null {
  if (!ask || !tab || waitingMessages(tab).length === 0) return null
  if (askState(ask, viewerId, tab.messages, now) !== 'requester') return null

  return {
    status: 'pending',
    text: t('Waiting for {name} to sign in. Your message is sent once they do.', {
      name: ask.askedName,
    }),
  }
}
