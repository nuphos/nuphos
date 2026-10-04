import { concreteModelChoices, isDefaultModel } from '../../../lib/modelChoices'

import { ChevronDown, ChevronLeft, Loader2, RefreshCw, Zap } from 'lucide-react'

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'

import type { useSessionConfig } from './useSessionConfig'
import type { SessionConfigOption, SessionConfigState } from '../../../api/session-config-types'

function currentLabel(option: SessionConfigOption) {
  if (option.kind === 'model') {
    const { current, label } = concreteModelChoices(
      option.options.map((choice) => ({ ...choice, id: choice.value })),
      option.currentValue,
    )

    return label ?? current ?? ''
  }
  if (option.kind === 'effort' && option.currentValue === 'default') return ''

  return (
    option.options.find((choice) => choice.value === option.currentValue)?.name ??
    option.currentValue
  )
}

/** Show the model whenever one is known; "unavailable" means the agent is offline. */
function modelLabel(
  model: SessionConfigOption | undefined,
  status: SessionConfigState['status'] | undefined,
) {
  if (model) return currentLabel(model)
  if (status === 'offline') return 'Model unavailable'

  return ''
}

function modelHint(
  status: SessionConfigState['status'] | undefined,
  hasModel: boolean,
  busy: boolean,
  stalled: boolean,
) {
  if (status === 'offline')
    return 'This agent is offline. Model settings return when it reconnects.'
  if (busy && stalled)
    return "This agent hasn't responded in a while — it may be stuck. Try reconnecting below."
  if (busy) return 'Changes apply after this reply.'
  if (status === 'dormant' && !hasModel)
    return 'Send a message to start this session before changing model settings.'
}

export function ModelSelector({
  control,
  disabled,
  streaming,
}: {
  control: ReturnType<typeof useSessionConfig>
  disabled: boolean
  streaming: boolean
}) {
  const { data, loading, slow, saving, error, stalled } = control
  const options = data?.options.map((option) => {
    const queued = control.queued?.find((selection) => selection.configId === option.id)

    return queued ? { ...option, currentValue: queued.value } : option
  })
  const model = options?.find((option) => option.kind === 'model')
  const status = data?.status
  const busy = status === 'busy' || streaming

  // A runtime that exposes no model controls gets no picker at all.
  if (status === 'unsupported') return null
  const label = modelLabel(model, status) || control.initialModelName || ''
  const blocked =
    disabled ||
    saving ||
    Boolean(error) ||
    slow ||
    (status !== 'ready' && status !== 'dormant' && status !== 'busy')
  const hint = modelHint(status, Boolean(model), busy, stalled)

  return (
    <Menu open={control.open} onOpenChange={control.setOpen}>
      <MenuTrigger
        aria-label={`Model settings: ${label}`}
        className="flex h-7 min-w-0 max-w-48 items-center gap-1 rounded-full px-2 text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main"
      >
        {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        {label ? (
          <span className="truncate">{label}</span>
        ) : (
          <span
            aria-label="Loading model"
            className="h-3 w-24 animate-pulse rounded bg-zGray-700/60 motion-reduce:animate-none"
          />
        )}
        {data?.options.some((option) => option.kind === 'fast' && option.currentValue === 'on') && (
          <Zap className="h-3 w-3 shrink-0" />
        )}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuContent side="top" align="end" className="w-72">
        {(loading || slow) && !error && (
          <p role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-tertiary">
            {!slow && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {slow
              ? 'The agent is reconnecting. This may take a moment.'
              : 'Getting model settings…'}
          </p>
        )}
        {error && (
          <p role="alert" className="px-2.5 py-2 text-xs text-error">
            {error}
          </p>
        )}
        {error && model && (
          <p className="px-2.5 pb-2 text-[11px] text-tertiary">Showing last synced settings.</p>
        )}
        {control.queued && (
          <p className="px-2.5 py-2 text-xs text-tertiary">Selected for the next reply.</p>
        )}
        {!control.queued && hint && <p className="px-2.5 py-2 text-xs text-tertiary">{hint}</p>}
        {disabled && !busy && status === 'ready' && (
          <p className="px-2.5 py-2 text-xs text-tertiary">
            Available when this conversation is ready for your next message.
          </p>
        )}
        {options?.map((option) => (
          <MenuSubmenu key={option.id}>
            <MenuSubmenuTrigger
              disabled={blocked}
              chevron={<ChevronLeft className="h-3 w-3 opacity-60" />}
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span>
                  {option.kind === 'model' ? 'Model' : option.kind === 'effort' ? 'Effort' : 'Fast'}
                </span>
                <span className="truncate text-xs text-tertiary">{currentLabel(option)}</span>
              </span>
            </MenuSubmenuTrigger>
            <MenuContent side="left" align="end" className="max-h-80 w-72">
              {option.options
                .filter(
                  (choice) => option.kind === 'fast' || !isDefaultModel(choice.value, choice.name),
                )
                .map((choice) => (
                  <MenuItem
                    key={choice.value}
                    selected={choice.value === option.currentValue}
                    disabled={blocked}
                    closeOnClick={false}
                    onClick={() => control.select({ configId: option.id, value: choice.value })}
                  >
                    {choice.name}
                  </MenuItem>
                ))}
            </MenuContent>
          </MenuSubmenu>
        ))}
        {(error || stalled) && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={
                loading || saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )
              }
              disabled={saving || loading}
              closeOnClick={false}
              onClick={control.refresh}
            >
              Retry connection
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
