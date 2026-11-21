import clsx from 'clsx'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { t } from '../../../i18n'
import { effortLabel } from '../../../lib/configLabels'
import { effortStops } from '../../../lib/effortStops'
import { Kbd } from '../../ui/kbd'
import { Menu, MenuPanel, MenuTrigger } from '../../ui/menu'
import { Tooltip } from '../../ui/tooltip'

import { ModelChipLabel } from './ModelChipLabel'
import { ModelEffortPanel } from './ModelEffortPanel'
import { ModelMenuFooter } from './ModelFooter'
import { ModelMenu } from './ModelMenu'
import {
  composerOf,
  EFFORT_SHORTCUT,
  effortName,
  modelHint,
  modelName,
  ownsShortcut,
} from './modelSelectorParts'

import type { useSessionConfig } from './useSessionConfig'

export type ModelControl = Pick<
  ReturnType<typeof useSessionConfig>,
  'data' | 'loading' | 'slow' | 'saving' | 'error' | 'writeError' | 'queued' | 'open' | 'select'
> & { setOpen: (open: boolean) => void; refresh: () => void }

function chipLabel(name: string, fast: string | undefined) {
  if (fast === 'on') return t('Model settings: {name}, fast mode on', { name })
  if (fast === 'ultrafast') return t('Model settings: {name}, Ultrafast mode on', { name })

  return t('Model settings: {name}', { name })
}

export function ModelSelector({
  control,
  disabled,
  hero = false,
  disabledHint,
  prioritizeModelName = false,
}: {
  control: ModelControl
  disabled: boolean
  /** Sized like the hero composer's other controls; compact otherwise. */
  hero?: boolean
  /** Why the picker is disabled, when it is not just waiting for the task. */
  disabledHint?: string
  prioritizeModelName?: boolean
}) {
  const { data, loading, slow, saving, error, writeError } = control
  // A refused change reports its own reason; a stalled connection keeps its note.
  const failure = writeError ?? error
  const chipRef = useRef<HTMLButtonElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = data?.options.map((option) => {
    const queued = control.queued?.find((selection) => selection.configId === option.id)

    return queued ? { ...option, currentValue: queued.value } : option
  })
  const model = options?.find((option) => option.kind === 'model')
  const effort = options?.find((option) => option.kind === 'effort')
  const fast = options?.find((option) => option.kind === 'fast')
  const status = data?.status
  const busy = status === 'busy'
  let name = slow ? t('Connecting…') : t('Model settings')

  if (error || status === 'offline') name = t('Model unavailable')
  if (model) name = modelName(model) || name
  const modelOnly = prioritizeModelName && Boolean(model)
  const level = effortName(effort)
  const effortLevels = [
    ...new Set([level, ...effortStops(effort?.options ?? []).map((choice) => effortLabel(choice))]),
  ].filter(Boolean)
  const blocked =
    disabled || saving || (status !== 'ready' && status !== 'dormant' && status !== 'busy')
  const hint = modelHint(status, Boolean(model), busy, Boolean(effort || fast), data?.reason)

  const setOpen = control.setOpen
  const open = control.open

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        !event.shiftKey ||
        event.metaKey ||
        event.altKey ||
        event.code !== 'KeyM'
      )
        return
      const chip = chipRef.current

      // ⌃⇧M again closes it, wherever focus went inside the popover.
      if (open) {
        event.preventDefault()
        setOpen(false)

        return
      }
      if (!chip?.isConnected || !ownsShortcut(chip)) return
      event.preventDefault()
      setOpen(true)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  // A runtime that exposes no model controls gets no picker at all.
  if (status === 'unsupported') return null
  const select = (configId: string, value: string) => control.select({ configId, value })
  const pickModel = (value: string) => {
    if (!model) return
    select(model.id, value)
    control.setOpen(false)
  }
  const footer = {
    lines: [
      (loading || slow) &&
        !failure &&
        (slow
          ? t('The runtime is reconnecting. This may take a moment.')
          : t('Getting model settings…')),
      failure,
      failure && model && t('Showing last synced settings.'),
      control.queued ? t('Selected for the next reply.') : hint,
      disabled &&
        (disabledHint ??
          (!busy &&
            status === 'ready' &&
            t('Available when this task is ready for your next message.'))),
    ].filter((line): line is string => Boolean(line)),
    error: failure ?? undefined,
    onRetry: error || status === 'offline' ? control.refresh : undefined,
    retrying: loading || saving,
  }
  // Closing returns to the message box, so typing carries on, unless the person
  // already moved on: the runtime list opened while this menu closed lost focus
  // to it and closed again (#3862).
  const finalFocus = () => {
    const focused = document.activeElement
    // The chip counts as the menu's own: pressing it to close still returns to typing.
    const movedOn =
      focused !== null &&
      focused !== document.body &&
      !menuRef.current?.contains(focused) &&
      !chipRef.current?.contains(focused)

    return movedOn
      ? false
      : (composerOf(chipRef.current)?.querySelector<HTMLElement>('[aria-label="Message"]') ?? true)
  }

  // Shown once the task's own settings are known, never a placeholder before them.
  if (loading && !slow && !error && !data) return null

  // One menu: the models, with effort and fast pinned under them. A runtime
  // without effort opens straight on its models; one without a model list
  // (Grok Build) on its effort.
  return (
    <Menu
      open={control.open}
      onOpenChange={control.setOpen}
      // Start on the current model, scrolled into view and highlighted, so ↑/↓
      // move from where the user is. Base UI's Menu offers no way to set the
      // highlighted item and does not follow focus, but it highlights the item
      // the pointer moves over, so the checked row is given one such move.
      onOpenChangeComplete={(shown) => {
        if (!shown) return
        const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')

        if (!checked) {
          if (!model) sliderRef.current?.focus()

          return
        }
        checked.focus()
        checked.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      }}
    >
      <Tooltip
        content={
          <span className="flex items-center gap-2">
            {model ? t('Select model') : t('Select effort')} <Kbd combo={EFFORT_SHORTCUT} />
          </span>
        }
        disabled={control.open}
        triggerClassName={modelOnly ? 'min-w-0 shrink-0 max-w-[65%]' : 'min-w-0'}
      >
        <MenuTrigger
          ref={chipRef}
          data-model-chip=""
          aria-label={chipLabel([name, level].filter(Boolean).join(' '), fast?.currentValue)}
          title={modelOnly ? name : undefined}
          // A filled pill at rest, so opening it changes nothing but the text.
          className={clsx(
            modelOnly ? 'min-h-7 py-1' : hero ? 'h-8' : 'h-7',
            modelOnly ? 'max-w-full' : 'max-w-64',
            'flex min-w-0 items-center gap-1 rounded-md px-2 text-[13px] text-main outline-none transition-colors hover:bg-state-hover focus-visible:bg-state-hover',
          )}
        >
          {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
          <ModelChipLabel
            name={name}
            level={modelOnly ? '' : level}
            levels={modelOnly ? [] : effortLevels}
            alwaysShowName={modelOnly}
            fast={fast?.currentValue}
          />
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className="hidden shrink-0 text-tertiary @[320px]:block"
          />
        </MenuTrigger>
      </Tooltip>
      <MenuPanel
        ref={menuRef}
        finalFocus={finalFocus}
        className="w-72"
        footer={
          <>
            {(effort || fast) && (
              <div className={clsx(model && 'border-t border-line-control/60')}>
                <ModelEffortPanel
                  effort={effort}
                  fast={fast}
                  blocked={blocked && !saving}
                  saving={saving}
                  sliderRef={sliderRef}
                  onSelect={select}
                />
              </div>
            )}
            {footer.lines.length > 0 && (
              <div
                className={clsx(
                  'px-1 pb-1',
                  (model || effort || fast) && 'border-t border-line-control/60 pt-1',
                )}
              >
                <ModelMenuFooter {...footer} />
              </div>
            )}
          </>
        }
      >
        {model && <ModelMenu model={model} blocked={blocked} onSelect={pickModel} />}
      </MenuPanel>
    </Menu>
  )
}
