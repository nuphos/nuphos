import { useEffect, useRef } from 'react'

import { ClaudeIcon, CodexIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { useStableCallback } from '../../../hooks/useStableCallback'

import { LOCAL_AGENT_INFO, readyLocalAgents } from './agentSetup'
import { autoFinish } from './autoFinish'
import { SetupScreen, StatusPill } from './SetupChrome'

import type { ReactNode } from 'react'

function AgentRow({
  icon,
  name,
  where,
  status,
}: {
  icon: ReactNode
  name: string
  where: string
  status: 'ready'
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-zGray-800 bg-zGray-900 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zGray-800 text-main">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-main">{name}</p>
        <p className="text-[12px] text-tertiary">{where}</p>
      </div>
      <StatusPill status={status} />
    </li>
  )
}

/** What this flow set up, before landing in the app: it moves on by itself after a beat. */
export function SetupComplete({ onFinish }: { onFinish: () => void }) {
  const local = readyLocalAgents(useLocalRuntimeState())
  const empty = local.length === 0
  const finishLatest = useStableCallback(onFinish)
  const auto = useRef<ReturnType<typeof autoFinish> | null>(null)

  useEffect(() => {
    auto.current = autoFinish(finishLatest)

    return auto.current.cancel
  }, [finishLatest])

  return (
    <SetupScreen
      title="You’re all set"
      subtitle={
        empty
          ? 'You can add runtimes any time from Settings › Runtimes.'
          : 'These runtimes are ready for your agents.'
      }
      actions={<Button onClick={() => auto.current?.finish()}>Start using Nuphos</Button>}
    >
      {!empty && (
        <ul className="space-y-3">
          {local.map((provider) => {
            const Icon = provider === 'codex' ? CodexIcon : ClaudeIcon

            return (
              <AgentRow
                key={provider}
                icon={<Icon className="h-5 w-5" />}
                name={LOCAL_AGENT_INFO[provider].name}
                where="On this computer"
                status="ready"
              />
            )
          })}
        </ul>
      )}
    </SetupScreen>
  )
}
