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
  return (
    option.options.find((choice) => choice.value === option.currentValue)?.name ??
    option.currentValue
  )
}

/** Trigger copy while there is no model to show yet. */
function awaitingModelLabel(busy: boolean, stalled: boolean) {
  if (!busy) return 'Loading model…'

  return stalled ? 'Agent not responding' : 'Waiting for reply…'
}

function modelHint(
  busy: boolean,
  stalled: boolean,
  streamingWithoutModel: boolean,
  status: SessionConfigState['status'] | undefined,
) {
  if (busy && stalled)
    return "This agent hasn't responded in a while — it may be stuck. Try reconnecting below."
  if (busy || streamingWithoutModel) return 'Model settings are available after this reply.'
  if (status === 'dormant')
    return 'Send a message to start this session before changing model settings.'
  if (status === 'unsupported') return 'Model settings are not available for this agent.'
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
  const model = data?.options.find((option) => option.kind === 'model')
  const busy = data?.status === 'busy'
  const awaitingModel = !model && !error && (loading || streaming || busy)
  const label = model
    ? currentLabel(model)
    : awaitingModel
      ? awaitingModelLabel(busy, stalled)
      : 'Model unavailable'
  const blocked = disabled || saving || Boolean(error) || slow || data?.status !== 'ready'
  const hint = modelHint(busy, stalled, streaming && !model, data?.status)

  return (
    <Menu open={control.open} onOpenChange={control.setOpen}>
      <MenuTrigger
        aria-label={`Model settings: ${label}`}
        className="flex h-7 min-w-0 max-w-48 items-center gap-1 rounded-full px-2 text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main"
      >
        {(saving || awaitingModel) && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        <span className="truncate">{label}</span>
        {data?.options.some((option) => option.kind === 'fast' && option.currentValue === 'on') && (
          <Zap className="h-3 w-3 shrink-0" />
        )}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuContent side="top" align="end" className="w-72">
        <div className="px-2.5 py-1.5 text-[11px] text-tertiary">Model settings</div>
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
        {hint && <p className="px-2.5 py-2 text-xs text-tertiary">{hint}</p>}
        {disabled && data?.status === 'ready' && (
          <p className="px-2.5 py-2 text-xs text-tertiary">
            Available when this conversation is ready for your next message.
          </p>
        )}
        {data?.options.map((option) => (
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
              {option.description && (
                <p className="px-2.5 py-2 text-[11px] text-tertiary">{option.description}</p>
              )}
              {option.options.map((choice) => (
                <MenuItem
                  key={choice.value}
                  selected={choice.value === option.currentValue}
                  disabled={blocked}
                  title={choice.description}
                  closeOnClick={false}
                  onClick={() => control.select({ configId: option.id, value: choice.value })}
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{choice.name}</span>
                    {choice.description && (
                      <span className="text-[11px] text-tertiary">{choice.description}</span>
                    )}
                  </span>
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
