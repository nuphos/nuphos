import { t } from '../../../i18n/index.ts'

import { agentFixLabel } from './agentRowFix.ts'
import { selectedAgentName } from './runtimeControlSignOut.ts'

import type { AgentFix } from './agentRowFix.ts'
import type { RuntimeControl } from './RuntimeSelector'

export type BannerCopy = { text: string; action: { label: string; run: () => void } | null }

/** What the banner can start: the picker's fixes, and the sign-in this conversation already asked for. */
export type BannerFixes = {
  run: (fix: AgentFix) => void
  canAsk: (fix: AgentFix) => boolean
  /** Who this window asked to sign the agent in, once it has. */
  askedName?: string
}

/**
 * The banner's words for an agent that cannot take a message, and the one thing to do
 * about it: the same fix the picker offers for that agent.
 */
export function reachabilityCopy(
  reachability: 'signIn' | 'offline',
  control: Pick<RuntimeControl, 'value' | 'options' | 'onSettings'>,
  fix: AgentFix | undefined,
  fixes: BannerFixes,
  onSwitchAgent?: () => void,
): BannerCopy {
  const runFix = fixes.run
  const name = selectedAgentName(control)
  // A new chat has nothing to retry or reconnect yet: it just starts on another agent.
  const switchAgent = onSwitchAgent && { label: t('Switch runtime'), run: onSwitchAgent }

  if (reachability === 'offline') {
    const box = control.options?.find((instance) => instance.id === control.value?.id)?.local
      ?.deviceLabel

    return {
      text: box ? t('{box} is offline.', { box }) : t('Its computer is offline.'),
      action:
        fix?.kind === 'resume'
          ? fixAction(fix, runFix)
          : (switchAgent ?? fixAction({ kind: 'retry' }, runFix)),
    }
  }
  if (switchAgent) return { text: t('{name} is signed out.', { name }), action: switchAgent }
  // A teammate's computer: only its owner can sign it in, administrators included.
  if (fix?.kind === 'ask') return askCopy(fix, fixes, name)
  // This computer's CLI, a runtime sign-in, or settings.
  if (fix && (fix.kind !== 'settings' || control.onSettings))
    return {
      text: t('{name} is signed out. Sign it in to send messages.', { name }),
      action: fixAction(fix, runFix),
    }

  return {
    text: t('{name} is signed out. Ask a workspace administrator to reconnect this runtime.', {
      name,
    }),
    action: null,
  }
}

function askCopy(
  fix: Extract<AgentFix, { kind: 'ask' }>,
  fixes: BannerFixes,
  name: string,
): BannerCopy {
  if (fixes.askedName)
    return {
      text: t('Asked {name}. You can send once they sign it in.', { name: fixes.askedName }),
      action: null,
    }
  const label = fix.name ? t('Ask {name} to sign in', { name: fix.name }) : t('Ask to sign in')

  return {
    text: t('{name} is signed out. Ask its owner to sign it in.', { name }),
    action: fixes.canAsk(fix) ? { label, run: () => fixes.run(fix) } : null,
  }
}

function fixAction(fix: AgentFix, runFix: (fix: AgentFix) => void) {
  const label = fix.kind === 'settings' ? t('Runtime settings') : agentFixLabel(fix)

  return label ? { label, run: () => runFix(fix) } : null
}
