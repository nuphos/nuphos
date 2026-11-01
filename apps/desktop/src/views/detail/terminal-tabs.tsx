import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { PodTerminalView, ExecTerminalView } from '../../components/PodTerminalView'
import { toast } from '../../components/ui/toast'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { t } from '../../i18n'
import { execScope, execSessionKey } from '../../lib/terminalTabTeardown'
import { useResetOnKey } from '../useResetOnKey'

import { allPodContainers, containerDisplayName } from './pod-containers'

// One sentence for translators: <b>…</b> marks emphasis, {name} and {ns} render
// as code. Split so each marked part can be styled.
const NODE_SHELL_WARNING = t(
  "This starts a <b>privileged pod</b> on {name} and enters the host's namespaces — effectively a <b>root shell on the node</b>. The pod is created in {ns} and deleted automatically when you close this tab or leave this node. It survives switching agents, so a command you left running keeps running.",
).split(/(<b>.*?<\/b>|\{name\}|\{ns\})/)

// Terminal tab for a Pod: resolves the container list, lets the user pick one
// (when there's more than one), and mounts an exec terminal. Keying the
// terminal by container restarts the session cleanly on a container switch.
export function PodTerminalTab({ namespace, name }: { namespace: string; name: string }) {
  const context = useRequiredKubeContext()
  const [containers, setContainers] = useState<{ name: string; label: string }[]>([])
  const [container, setContainer] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')

  useResetOnKey(`${context}\0${namespace}\0${name}`, () => {
    setContainers([])
    setContainer(null)
    setPhase('loading')
  })

  useEffect(() => {
    let cancelled = false

    api
      .getPodDetail(context, namespace, name)
      .then((d) => {
        if (cancelled) return
        const all = allPodContainers(d).map((c) => ({
          name: c.name,
          label: containerDisplayName(c),
        }))

        setContainers(all)
        setContainer(all[0]?.name ?? null)
        setPhase('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Error detail goes to the toast (per CLAUDE.md); the body just leaves
        // the loading state so it doesn't spin forever.
        setPhase('error')
        toast.apiError(t('Could not load pod containers'), e)
      })

    return () => {
      cancelled = true
    }
  }, [context, namespace, name])

  return (
    <div className="flex flex-col h-full">
      {containers.length > 1 && (
        <div className="px-6 py-2 border-b border-zGray-800 flex items-center gap-2 bg-zGray-900">
          <span className="text-[11.5px] text-tertiary uppercase tracking-wider">
            {t('Container:')}
          </span>
          {containers.map((c) => (
            <button
              key={c.name}
              onClick={() => setContainer(c.name)}
              className={clsx(
                'px-2 py-1 rounded text-[12px]',
                container === c.name
                  ? 'bg-zViolet-500/20 text-zViolet-accent'
                  : 'text-secondary hover:bg-zGray-800',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {container ? (
          <PodTerminalView key={container} namespace={namespace} pod={name} container={container} />
        ) : (
          <div className="p-6 text-tertiary text-[13px]">
            {phase === 'loading'
              ? t('Loading…')
              : phase === 'error'
                ? t("Couldn't load this pod's containers.")
                : t('This pod has no containers.')}
          </div>
        )}
      </div>
    </div>
  )
}

// Node terminal: gated behind an explicit confirmation because opening it
// creates a privileged pod on the node (= host root). The pod is only created
// once the user confirms (ExecTerminalView's start runs on mount), and is torn
// down when the tab closes or navigates off this node — not when this view
// unmounts, which happens on every chat-session switch.
export function NodeTerminalTab({ name }: { name: string }) {
  const context = useRequiredKubeContext()
  const { tabId } = useWorkspaceTab()
  const sessionKey = execSessionKey(tabId, execScope(context, 'Node', null, name), '')
  // Reattaching to a shell this tab already opened is not a new decision, and
  // the view is unmounted and remounted every time the dock swaps chat session.
  // `null` = still asking; showing the warning first and then yanking it away
  // would be worse than a frame of nothing.
  const [confirmed, setConfirmed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .podExecHasSession(sessionKey)
      .then((exists) => {
        if (!cancelled) setConfirmed(exists)
      })
      .catch(() => {
        if (!cancelled) setConfirmed(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionKey])

  if (confirmed === null) return <div className="flex-1 min-h-0" />

  if (!confirmed) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-8">
        <div className="max-w-md bg-zGray-900 border border-zGray-800 rounded-md p-5 space-y-3">
          <div className="flex items-center gap-2 text-warning text-[13px] font-semibold">
            <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4" />
            {t('Open a node shell?')}
          </div>
          <p className="text-[12.5px] text-secondary leading-relaxed">
            {NODE_SHELL_WARNING.map((part, i) =>
              part.startsWith('<b>') && part.endsWith('</b>') ? (
                <span key={i} className="text-main font-medium">
                  {part.slice(3, -4)}
                </span>
              ) : part === '{name}' ? (
                <span key={i} className="text-main font-mono">
                  {name}
                </span>
              ) : part === '{ns}' ? (
                <span key={i} className="font-mono">
                  kube-system
                </span>
              ) : (
                part
              ),
            )}
          </p>
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            className="px-3 py-1.5 rounded text-[12.5px] bg-warning/15 text-warning hover:bg-warning/25"
          >
            {t('Open node shell')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <ExecTerminalView
      label={name}
      sessionKey={sessionKey}
      start={(opts) => api.nodeExecStart(sessionKey, context, name, opts)}
    />
  )
}
