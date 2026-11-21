import clsx from 'clsx'
import { ChevronDown, Lock, Unlock } from 'lucide-react'

import { t } from '../../../i18n'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { SummaryMenuRow } from '../summary/ChatSummaryRows'

export function BypassControlMenu({
  bypassControl,
  hero,
  asRow,
  compact = false,
}: {
  /** active is undefined until the task's own mode is known. */
  bypassControl: { active: boolean | undefined; onSelect: (bypass: boolean) => void }
  hero: boolean
  /** A row of a details panel, opening the menu under it, instead of a composer chip. */
  asRow?: boolean
  compact?: boolean
}) {
  const { active } = bypassControl
  const mode = active ? t('Full Access') : t('Auto Mode')
  // Both labels always share one cell, the inactive one unseen, so the chip is
  // always the wider label's width: nothing moves when the mode arrives or changes.
  // Until it is known the whole chip is unseen too: no wrong mode shows.

  return (
    <Menu>
      {asRow ? (
        <SummaryMenuRow
          aria-label={t('Authorization mode')}
          className={clsx(active === undefined && 'invisible')}
          title={t('Choose how commands in this task are authorized')}
          icon={
            active ? (
              <Unlock className="size-3.5" strokeWidth={1.8} />
            ) : (
              <Lock className="size-3.5" strokeWidth={1.8} />
            )
          }
          label={active ? t('Full Access') : t('Auto Mode')}
          note={<ChevronDown className="size-3.5" strokeWidth={1.8} />}
        />
      ) : (
        <MenuTrigger
          aria-label={t('Authorization mode')}
          aria-description={compact ? mode : undefined}
          aria-hidden={active === undefined || undefined}
          className={clsx(
            compact ? 'flex' : 'hidden @[210px]:flex',
            'items-center gap-1.5 flex-shrink-0 rounded-md transition-colors',
            hero ? 'h-8 px-1.5 @[400px]:px-3' : 'h-7 px-1.5 @[400px]:px-2.5',
            'text-secondary hover:text-main hover:bg-state-hover',
            active === undefined && 'invisible',
          )}
          title={compact ? mode : t('Choose how commands in this task are authorized')}
        >
          {compact ? (
            active ? (
              <Unlock className="size-3.5 text-warning" aria-hidden />
            ) : (
              <Lock className="size-3.5" aria-hidden />
            )
          ) : (
            <span className="grid text-[12.5px] font-medium">
              {[true, false].map((full) => (
                <span
                  key={String(full)}
                  aria-hidden={full !== active || undefined}
                  className={clsx(
                    'col-start-1 row-start-1 flex items-center',
                    full !== active && 'invisible',
                  )}
                >
                  {full ? (
                    <Unlock className="w-3.5 h-3.5 @[400px]:hidden" strokeWidth={2} aria-hidden />
                  ) : (
                    <Lock className="w-3.5 h-3.5 @[400px]:hidden" strokeWidth={2} aria-hidden />
                  )}
                  <span className="hidden @[400px]:inline @[520px]:hidden">
                    {full ? t('Full') : t('Auto')}
                  </span>
                  <span className="hidden @[520px]:inline">
                    {full ? t('Full Access') : t('Auto Mode')}
                  </span>
                </span>
              ))}
            </span>
          )}
          <ChevronDown
            className={clsx('size-3 opacity-60', !compact && 'hidden @[400px]:block')}
            strokeWidth={2}
          />
        </MenuTrigger>
      )}
      <MenuContent side={asRow ? 'bottom' : 'top'} align={asRow ? 'end' : 'start'} className="w-64">
        <MenuItem selected={active === false} onClick={() => bypassControl.onSelect(false)}>
          <div className="flex flex-col">
            <span>{t('Auto Mode')}</span>
            <span className="text-[11px] text-tertiary">
              {t('Risky commands ask for your approval')}
            </span>
          </div>
        </MenuItem>
        <MenuItem selected={active === true} onClick={() => bypassControl.onSelect(true)}>
          <div className="flex flex-col">
            <span>{t('Full Access')}</span>
            <span className="text-[11px] text-tertiary">
              {t('Run every command without asking')}
            </span>
          </div>
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
