import { LayoutTemplate, Plus, Upload } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { t } from '../../i18n'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { Button } from '../ui/button'

import type { CSSProperties, ReactNode } from 'react'

export function BotStartIntro({
  onCreate,
  onTemplate,
  onImport,
  visible = true,
  firstBot = false,
}: {
  visible?: boolean
  firstBot?: boolean
  onCreate: () => void
  onTemplate: () => void
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

  return (
    <section ref={intro} className="t-stagger t-bot-start w-full pb-1">
      <Line index={0}>
        <div aria-hidden className="mb-7 flex h-[88px] items-end gap-3">
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
      </Line>
      <Line index={1}>
        <h1 className="text-2xl font-semibold tracking-tight text-main">
          {firstBot ? t('Start with your first Bot') : t('New Bot')}
        </h1>
      </Line>
      <Line index={2}>
        <p className="mt-3 max-w-[540px] text-sm leading-relaxed text-secondary">
          {t('A familiar face for ongoing work. Pick a name and bring your team in.')}
        </p>
      </Line>
      <Line index={3}>
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Button onClick={onCreate}>
            <Plus className="size-4" strokeWidth={1.8} />
            {t('New Bot')}
          </Button>
          <Button variant="secondary" onClick={onTemplate}>
            <LayoutTemplate className="size-4" strokeWidth={1.8} />
            {t('Start from a template')}
          </Button>
          <Button variant="secondary" onClick={onImport}>
            <Upload className="size-4" strokeWidth={1.8} />
            {t('Import from Grok Bot')}
          </Button>
        </div>
      </Line>
    </section>
  )
}

/** One line of the texts reveal: the preset's line moves; what it holds keeps its own layout. */
function Line({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="t-stagger-line" style={{ '--line': index } as CSSProperties}>
      {children}
    </div>
  )
}
