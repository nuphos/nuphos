import { ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { ClaudeIcon, CodexIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { t } from '../../../i18n'
import { isMac } from '../../../lib/platform'
import { ClaudeSignInCode } from '../../settings/ClaudeSignInCode'
import { InstallButton } from '../../settings/LocalAgentCard'
import { useLocalAgentLogin } from '../../settings/useLocalAgentLogin'

import {
  LOCAL_AGENT_INFO,
  LOCAL_SETUP_PROVIDERS,
  setupAgentStatus,
  readyLocalAgents,
} from './agentSetup'
import { SetupScreen, StatusPill } from './SetupChrome'

import type { CliLoginProvider } from '../../../api'

const ICON = { 'claude-code': ClaudeIcon, codex: CodexIcon } as const

/** Sign-in inside the card: start it, then follow the browser step until the CLI reports back. */
function InlineSignIn({ provider }: { provider: CliLoginProvider }) {
  const { login, busy, retry, start, cancel } = useLocalAgentLogin(provider, true)
  const [codePre, codePost = ''] = t('Enter this one-time code: {code}').split('{code}')

  if (!busy)
    return (
      <Button size="sm" onClick={() => void start()}>
        {retry ? t('Try again') : t('Sign in')}
      </Button>
    )

  return (
    <div className="w-full space-y-2 text-[12.5px] text-secondary" role="status" aria-live="polite">
      <p className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {login?.state === 'checking'
          ? t('Verifying your sign-in…')
          : t('Finish signing in in your browser…')}
      </p>
      {login?.userCode && (
        <p>
          {codePre}
          <code className="select-all font-semibold text-main">{login.userCode}</code>
          {codePost}
        </p>
      )}
      {provider === 'claude-code' && login?.state === 'waiting' && login.url && (
        <ClaudeSignInCode key={login.url} />
      )}
      <div className="flex items-center gap-3">
        {login?.url && (
          <a
            href={login.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary underline"
          >
            {t('Open the sign-in page')}
          </a>
        )}
        <Button size="sm" variant="ghost" onClick={() => void cancel()}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  )
}

/** The CLI may be installed but out of sight: a GUI app reads the login shell's PATH. */
function MissingCli({ command }: { command: string }) {
  const [pre, post = ''] = t(
    'Nuphos couldn’t find {command} on this computer. If it’s installed, add it to your login shell’s PATH, then reopen Nuphos.',
  ).split('{command}')

  return (
    <p className="text-[12.5px] leading-snug text-secondary">
      {pre}
      <code className="font-mono">{command}</code>
      {post}
    </p>
  )
}

/** Install it from here, or look again after installing it some other way. */
function MissingCliActions({ provider }: { provider: CliLoginProvider }) {
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      await api.localRuntimeRefresh()
    } catch {
      // The state push is the answer; a failed look leaves the card as it is.
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <InstallButton provider={provider} />
      <Button size="sm" variant="ghost" disabled={checking} onClick={() => void check()}>
        <RotateCw strokeWidth={1.5} className="mr-1.5 h-3.5 w-3.5" />
        {t('Check again')}
      </Button>
    </div>
  )
}

function LocalAgentSetupCard({ provider }: { provider: CliLoginProvider }) {
  const state = useLocalRuntimeState()
  const status = setupAgentStatus(state, provider)
  const { name, installUrl, command } = LOCAL_AGENT_INFO[provider]
  const Icon = ICON[provider]

  return (
    <div className="space-y-3 rounded-xl border border-line-control bg-surface-sheet px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-sunken text-main">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-main">{name}</p>
          <p className="text-[12px] text-tertiary">
            {status === 'ready' && t('Signed in and ready to use')}
            {status === 'checking' && t('Checking installation and sign-in…')}
            {status === 'signed-out' && t('Sign in to use your subscription')}
            {status === 'missing' && t('Install this runtime to get started')}
            {status === 'unavailable' && t('Local runtime detection is unavailable')}
          </p>
        </div>
        <StatusPill status={status} />
      </div>
      {status === 'signed-out' && <InlineSignIn provider={provider} />}
      {status === 'missing' && <MissingCli command={command} />}
      {status === 'missing' && <MissingCliActions provider={provider} />}
      {status === 'missing' && (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12.5px] text-secondary hover:underline"
        >
          {t('How to install')} <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

export function LocalAgentsStep({ onContinue }: { onContinue: () => void }) {
  const state = useLocalRuntimeState()
  const ready = readyLocalAgents(state).length > 0
  const checking = LOCAL_SETUP_PROVIDERS.some(
    (provider) => setupAgentStatus(state, provider) === 'checking',
  )
  let continueLabel = t('Set up later')

  if (ready) continueLabel = t('Continue')
  else if (checking) continueLabel = t('Checking runtimes…')

  return (
    <SetupScreen
      step={2}
      title={isMac ? t('Connect runtimes on this Mac') : t('Connect runtimes on this computer')}
      subtitle={
        isMac
          ? t(
              'Use Claude Code or Codex with the subscriptions you already have. Here’s what we found on this Mac.',
            )
          : t(
              'Use Claude Code or Codex with the subscriptions you already have. Here’s what we found on this computer.',
            )
      }
      hint={t('You can connect more runtimes later on the Runtimes page.')}
      actions={
        <>
          {checking && !ready && (
            <Button variant="ghost" onClick={onContinue}>
              {t('Set up later')}
            </Button>
          )}
          <Button onClick={onContinue} disabled={checking && !ready}>
            {continueLabel}
          </Button>
        </>
      }
    >
      <LocalAgentSetupCards />
    </SetupScreen>
  )
}

/** The same account cards, usable in-place without the onboarding screen. */
export function LocalAgentSetupCards() {
  const state = useLocalRuntimeState()

  return (
    <div className="space-y-3">
      {state?.detectionDisabled && (
        <p
          role="status"
          className="rounded-lg bg-state-selected px-4 py-3 text-[12.5px] leading-5 text-secondary"
        >
          {t(
            'Local runtimes are disabled in development builds connected to Nuphos Cloud. This keeps the installed app’s connection active. You can continue to preview onboarding.',
          )}
        </p>
      )}
      {LOCAL_SETUP_PROVIDERS.map((provider) => (
        <LocalAgentSetupCard key={provider} provider={provider} />
      ))}
    </div>
  )
}
