import clsx from 'clsx'
import { Box, Laptop, Server } from 'lucide-react'

import { StepActions } from './StepActions'

import type { AddAgentAction } from './addAgentFlow'
import type { ReactNode } from 'react'

/** One option card in Add agent: an icon, a title and what it does. */
export function Choice({
  icon,
  title,
  description,
  selected,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  selected?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? 'border-zViolet-500/70 bg-zViolet-500/10'
          : 'border-zGray-800 hover:border-zGray-700 hover:bg-zGray-800/40',
      )}
    >
      <span className="mt-0.5 text-secondary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-main">{title}</span>
        <span className="mt-0.5 block text-[12px] text-tertiary">{description}</span>
      </span>
    </button>
  )
}

/** Add agent's first step: what kind of agent to add. */
export function AddAgentChoices({
  boxAvailable,
  footer,
  onPick,
  onJoin,
  onCancel,
}: {
  boxAvailable: boolean
  footer: HTMLElement | null
  onPick: (action: AddAgentAction) => void
  /** Connect your own machine: shows a one-time join command. */
  onJoin: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-2">
      {boxAvailable && (
        <Choice
          icon={<Box className="h-4 w-4" />}
          title="New computer"
          description="A cloud computer Nuphos runs for you, with Claude Code and Codex. Sign in with your own account."
          onClick={() => onPick('box')}
        />
      )}
      {boxAvailable && (
        <Choice
          icon={<Laptop className="h-4 w-4" />}
          title="Connect your own machine"
          description="Connect a computer or server you run, with a one-time join command."
          onClick={onJoin}
        />
      )}
      <Choice
        icon={<Server className="h-4 w-4" />}
        title="Self-hosted runtime"
        description="Connect a runtime you run on your own server, with a pairing code from its console."
        onClick={() => onPick('self-hosted')}
      />
      <StepActions footer={footer} className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
        >
          Cancel
        </button>
      </StepActions>
    </div>
  )
}
