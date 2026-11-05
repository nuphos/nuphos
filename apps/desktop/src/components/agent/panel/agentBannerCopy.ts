import { t } from '../../../i18n/index.ts'

import { agentFixLabel } from './agentRowFix.ts'
import { selectedAgentName } from './runtimeControlSignOut.ts'

import type { AgentFix } from './agentRowFix.ts'
import type { RuntimeControl } from './RuntimeSelector'

export type BannerCopy = { text: string; action: { label: string; run: () => void } | null }

/**
 * The banner's words for an agent that cannot take a message, and the one thing to do
 * about it: the same fix the picker offers for that agent.
 */
export function reachabilityCopy(
  reachability: 'signIn' | 'offline',
  control: Pick<RuntimeControl, 'value' | 'options' | 'onSettings'>,
  fix: AgentFix | undefined,
  runFix: (fix: AgentFix) => void,
  onSwitchAgent?: () => void,
): BannerCopy {
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
  if (fix?.kind === 'ask')
    return { text: t('{name} is signed out. Ask its owner to sign it in.', { name }), action: null }
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

function fixAction(fix: AgentFix, runFix: (fix: AgentFix) => void) {
  const label = fix.kind === 'settings' ? t('Runtime settings') : agentFixLabel(fix)

  return label ? { label, run: () => runFix(fix) } : null
}
