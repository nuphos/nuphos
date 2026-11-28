import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { CloudLogo } from '../../../components/CloudLogo'
import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'

import { useSequence } from './sequence'
import { TOOL_GROUPS } from './tools'
import { TourLayout } from './TourLayout'

import type { TourTool } from './tools'

/** Page three: the tools the first Bot should reach. Its first chat helps connect them. */
export function ToolsPage({
  picks,
  onPicks,
  onNext,
}: {
  picks: readonly TourTool[]
  onPicks: (picks: TourTool[]) => void
  onNext: () => void
}) {
  const [shown, setShown] = useState(0)
  const { revealed } = useSequence(() =>
    TOOL_GROUPS.map((_, index) => [index === 0 ? 0.2 : 0.12, () => setShown(index + 1)] as const),
  )
  const toggle = (tool: TourTool) =>
    onPicks(picks.includes(tool) ? picks.filter((key) => key !== tool) : [...picks, tool])
  const groupLabel = groupLabels()

  return (
    <TourLayout
      dot={2}
      title={t('What should your Bot be able to reach?')}
      subtitle={t(
        'Pick the tools you use. Your Bot will help you connect them in your first chat.',
      )}
      revealed={revealed}
      actions={<Button onClick={onNext}>{picks.length ? t('Continue') : t('Skip')}</Button>}
      art={
        // As wide as its widest line, so the block sits centered under the title while its chips
        // keep to the left.
        <div className="w-fit max-w-[540px] space-y-3 text-left">
          {TOOL_GROUPS.map((group, index) => (
            <motion.div
              key={group.title}
              initial={false}
              animate={index < shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="space-y-1.5"
            >
              <p className="text-[11.5px] font-medium text-tertiary">{groupLabel[group.title]}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.tools.map((tool) => {
                  const on = picks.includes(tool.key)

                  return (
                    <button
                      key={tool.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(tool.key)}
                      className={clsx(
                        'flex items-center gap-1.5 rounded-full border bg-surface-raised px-2.5 py-1.5 text-[13px] text-primary transition-[border-color,box-shadow] duration-150',
                        on
                          ? 'border-[rgb(var(--color-text-base))] shadow-[inset_0_0_0_0.5px_rgb(var(--color-text-base))]'
                          : 'border-line-control hover:border-[rgba(var(--color-text-base),0.4)]',
                      )}
                    >
                      <CloudLogo provider={tool.logo} size={16} />
                      {tool.title}
                      {on && <Check className="size-3.5" strokeWidth={2.4} />}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          ))}
          <p className="pt-1 text-[12px] text-tertiary">
            {t('AWS, Grafana, databases, and 20+ more connect from Nuphos on your computer.')}
          </p>
        </div>
      }
    />
  )
}

function groupLabels(): Record<(typeof TOOL_GROUPS)[number]['title'], string> {
  return {
    personal: t('Personal'),
    communication: t('Communication'),
    projects: t('Projects & tasks'),
    docs: t('Docs & knowledge'),
    code: t('Code'),
    cloud: t('Cloud'),
    monitoring: t('Monitoring'),
  }
}
