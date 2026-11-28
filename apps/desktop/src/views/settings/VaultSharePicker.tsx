import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, Laptop, Search, X } from 'lucide-react'
import { useState } from 'react'

import { parseAtlasError } from '../../api/errors'
import { Checkbox } from '../../components/ui/checkbox'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

import type { VaultDevice } from '../../types/vault'

const SHOWN_NAMES = 8

/** The first computer an item is shared with, this one when it is among them, plus a count. */
function Summary({ names }: { names: string[] }) {
  return (
    <>
      <Laptop className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{names[0]}</span>
      {names.length > 1 && <span className="shrink-0 text-tertiary">+{names.length - 1}</span>}
    </>
  )
}

function subtitle(device: VaultDevice, last: boolean) {
  if (device.state === 'pending') return t('Approve it under Devices to share with it')
  if (last) return t('Only computer · can’t be removed')

  return device.fingerprint
}

/** One computer in the list; the last one picked explains why it stays. */
function ComputerRow({
  device,
  checked,
  last,
  busy,
  onToggle,
}: {
  device: VaultDevice
  checked: boolean
  last: boolean
  busy: boolean
  onToggle: (checked: boolean) => void
}) {
  const isPending = device.state === 'pending'
  const row = (
    <label
      className={clsx(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5',
        isPending ? 'opacity-60' : 'hover:bg-state-selected',
      )}
    >
      <Checkbox
        aria-label={device.name}
        checked={checked}
        disabled={isPending || last || busy}
        onCheckedChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-main">{device.name}</span>
        <span className={clsx('block text-[12px] text-tertiary', !isPending && 'truncate')}>
          {subtitle(device, last)}
        </span>
      </span>
      {isPending && (
        <span className="shrink-0 rounded bg-state-selected px-1.5 py-0.5 text-[11px] text-secondary">
          {t('Pending')}
        </span>
      )}
    </label>
  )

  if (!last) return row

  return (
    <Tooltip
      content={t(
        'Each item stays shared with at least one computer. Add another before removing this one.',
      )}
      triggerClassName="block"
    >
      {row}
    </Tooltip>
  )
}

/**
 * Picks the computers an item is shared with: a summary that opens a searchable list.
 * The list keeps the order it opened with, so a ticked row does not jump. A pending
 * computer is listed last and cannot be picked; the last picked one cannot be removed.
 */
export function VaultSharePicker({
  devices,
  thisDeviceId,
  chosen,
  shared,
  onChange,
  onReplaceValue,
  variant,
}: {
  devices: VaultDevice[]
  thisDeviceId: string
  chosen: string[]
  /** Computers already holding the key: removing one warns that it may have kept the value. */
  shared: string[]
  /** May save at once; a refusal is shown in the list. */
  onChange: (ids: string[]) => void | Promise<void>
  onReplaceValue: () => void
  variant: 'field' | 'chip'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState<string[]>([])
  const [heldAtOpen, setHeldAtOpen] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const enrolled = devices.filter((d) => d.state === 'enrolled')
  const pending = devices.filter((d) => d.state === 'pending')
  const byId = new Map(devices.map((d) => [d.id, d]))
  const picked = [...chosen].sort((a, b) => Number(b === thisDeviceId) - Number(a === thisDeviceId))
  const names = picked.map((id) => byId.get(id)?.name ?? id)
  const removed = heldAtOpen.filter((id) => !chosen.includes(id))
  const rows = order
    .map((id) => byId.get(id))
    .filter((d): d is VaultDevice => d !== undefined)
    .filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()))

  function openChange(next: boolean) {
    if (next) {
      const ids = (list: VaultDevice[]) => list.map((d) => d.id)

      setOrder([
        ...ids(enrolled.filter((d) => chosen.includes(d.id))),
        ...ids(enrolled.filter((d) => !chosen.includes(d.id))),
        ...ids(pending),
      ])
      setHeldAtOpen(shared)
      setQuery('')
      setError(null)
    }
    setOpen(next)
  }

  async function toggle(id: string, checked: boolean) {
    setError(null)
    setBusy(true)
    try {
      await onChange(checked ? [...chosen, id] : chosen.filter((c) => c !== id))
    } catch (err) {
      setError(t('Could not update sharing: {message}', { message: parseAtlasError(err).message }))
    } finally {
      setBusy(false)
    }
  }

  const triggerClass = clsx(
    'flex min-w-0 items-center gap-1.5 text-main outline-none',
    variant === 'field'
      ? 'h-9 w-full rounded-md border border-line-control bg-surface px-2.5 text-[13px]'
      : 'rounded px-1.5 py-0.5 text-[12px] text-secondary hover:bg-state-selected data-[popup-open]:bg-state-selected',
  )

  return (
    <Popover.Root open={open} onOpenChange={openChange}>
      {variant === 'chip' ? (
        <Tooltip
          disabled={open}
          trigger={<Popover.Trigger aria-label={t('Shared with')} className={triggerClass} />}
          content={
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {names.length > 1
                  ? t('Shared with {count} computers', { count: names.length })
                  : t('Shared with')}
              </span>
              {names.slice(0, SHOWN_NAMES).map((name) => (
                <span key={name}>{name}</span>
              ))}
              {names.length > SHOWN_NAMES && (
                <span>{t('and {count} more', { count: names.length - SHOWN_NAMES })}</span>
              )}
            </span>
          }
        >
          <Summary names={names} />
        </Tooltip>
      ) : (
        <Popover.Trigger aria-label={t('Shared with')} className={triggerClass}>
          <Summary names={names} />
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2} />
        </Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup className="w-[340px] rounded-xl border border-line-control/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.25)] outline-none">
            <div className="flex items-start gap-2.5 px-3 pt-3">
              <Laptop className="mt-1 h-4 w-4 shrink-0 text-secondary" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <Popover.Title className="m-0 text-[13px] font-medium text-main">
                  {t('Computers')}
                </Popover.Title>
                <p className="text-[12px] text-tertiary">
                  {t('{picked} of {total} selected', {
                    picked: chosen.length,
                    total: enrolled.length,
                  })}
                  {pending.length > 0 && ` · ${t('{count} waiting', { count: pending.length })}`}
                </p>
              </div>
              <Popover.Close aria-label={t('Close')} className="text-tertiary hover:text-main">
                <X className="h-4 w-4" strokeWidth={1.8} />
              </Popover.Close>
            </div>
            <InputGroup
              render={<label />}
              className="mx-3 mt-2.5 flex h-8 items-center gap-2 rounded-md border border-line-control bg-surface px-2"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={1.8} />
              <InputGroupInput
                aria-label={t('Search computers')}
                className="text-[13px] text-main placeholder:text-tertiary"
                placeholder={t('Search computers')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <div className="mt-2.5 max-h-[322px] overflow-y-auto border-t border-line-control/60 p-1">
              {rows.map((device) => (
                <ComputerRow
                  key={device.id}
                  device={device}
                  checked={chosen.includes(device.id)}
                  last={chosen.length === 1 && chosen[0] === device.id}
                  busy={busy}
                  onToggle={(next) => void toggle(device.id, next)}
                />
              ))}
              {!rows.length && (
                <p className="px-2 py-2 text-[12.5px] text-tertiary">
                  {t('No computers match “{query}”.', { query: query.trim() })}
                </p>
              )}
              {enrolled.length === 1 && !pending.length && (
                <p className="px-2 py-2 text-[12.5px] text-tertiary">
                  {t(
                    'This is the only computer in your vault. Add another under Devices, then share with it here.',
                  )}
                </p>
              )}
            </div>
            <p className="border-t border-line-control/60 px-3 py-2 text-[12.5px] text-tertiary">
              {t('Anyone who can use a computer you share with can read this item.')}
            </p>
            {error && (
              <p className="m-3 mt-0 rounded-md border border-error/30 bg-error/10 px-2.5 py-2 text-[12.5px] text-error">
                {error}
              </p>
            )}
            {removed.length > 0 && !error && (
              <div className="flex gap-2 border-t border-line-control/60 px-3 py-2.5 text-[12.5px]">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                  strokeWidth={1.8}
                />
                <div className="min-w-0">
                  <p className="text-main">
                    {t('{names} may have kept the value it already read.', {
                      names: removed.map((id) => byId.get(id)?.name ?? id).join(', '),
                    })}
                  </p>
                  <p className="text-tertiary">
                    {t('Rotate this secret where it was issued, then save the new value here.')}
                  </p>
                  <button
                    type="button"
                    className="mt-0.5 text-link hover:underline"
                    onClick={() => {
                      setOpen(false)
                      onReplaceValue()
                    }}
                  >
                    {t('Replace value')}
                  </button>
                </div>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
