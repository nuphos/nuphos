import clsx from 'clsx'
import { Plus, Upload } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { t } from '../../i18n'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { Button } from '../ui/button'

import type { CSSProperties } from 'react'

export function BotStartIntro({
  onCreate,
  onImport,
  visible = true,
  firstBot = false,
}: {
  visible?: boolean
  firstBot?: boolean
  onCreate: () => void
  onImport: () => void
}) {
  const intro = useRef<HTMLElement>(null)

  // Texts reveal: its lines rise in turn once shown, from a frame after mount so they animate.
  useEffect(() => {
    const el = intro.current

    if (!el) return
    if (!visible) {
      el.classList.remove('is-shown')

      return
    }
    el.getBoundingClientRect()
    const frame = requestAnimationFrame(() => el.classList.add('is-shown'))

    return () => cancelAnimationFrame(frame)
  }, [visible])
  const line = (index: number, className?: string) => ({
    className: clsx('t-stagger-line', className),
    style: { '--line': index } as CSSProperties,
  })

  return (
    <section ref={intro} className="t-stagger t-bot-start w-full pb-1">
      <div {...line(0, 'mb-7 flex h-[88px] items-end gap-3')} aria-hidden>
        <BotAvatarImage
          looping={visible}
          file="01-vermeer-girl.svg"
          className="size-[72px] object-contain"
        />
        <BotAvatarImage
          looping={visible}
          file="07-ada.svg"
          className="mb-3 size-[80px] object-contain"
        />
        <BotAvatarImage
          looping={visible}
          file="03-mona-lisa.svg"
          className="size-[72px] object-contain"
        />
      </div>
      <h1 {...line(1, 'text-2xl font-semibold tracking-tight text-main')}>
        {firstBot ? t('Start with your first Bot') : t('New Bot')}
      </h1>
      <p {...line(2, 'mt-3 max-w-[540px] text-sm leading-relaxed text-secondary')}>
        {t(
          'A familiar face for ongoing work. Pick a name and let your team join the conversation.',
        )}
      </p>
      <div {...line(3, 'mt-8 flex flex-wrap items-center gap-2')}>
        <Button onClick={onCreate}>
          <Plus className="size-4" strokeWidth={1.8} />
          {t('New Bot')}
        </Button>
        <Button variant="secondary" onClick={onImport}>
          <Upload className="size-4" strokeWidth={1.8} />
          {t('Import from Grok Bot')}
        </Button>
      </div>
    </section>
  )
}
