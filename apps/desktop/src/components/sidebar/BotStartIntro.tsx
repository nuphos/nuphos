import { motion, useReducedMotion } from 'framer-motion'
import { Plus, Upload } from 'lucide-react'

import { t } from '../../i18n'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { Button } from '../ui/button'

export function BotStartIntro({
  onCreate,
  onImport,
  visible = true,
}: {
  visible?: boolean
  onCreate: () => void
  onImport: () => void
}) {
  const reduceMotion = useReducedMotion()
  const reveal = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 8 },
    shown: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.35, ease: 'easeOut' as const },
    },
  }

  return (
    <motion.section
      className="w-full pb-1"
      initial="hidden"
      animate={visible ? 'shown' : 'hidden'}
      variants={{ shown: { transition: { staggerChildren: reduceMotion ? 0 : 0.055 } } }}
    >
      <motion.div variants={reveal} aria-hidden className="mb-7 flex h-[88px] items-end gap-3">
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
      </motion.div>
      <motion.h1 variants={reveal} className="text-2xl font-semibold tracking-tight text-main">
        {t('Start with your first Bot')}
      </motion.h1>
      <motion.p
        variants={reveal}
        className="mt-3 max-w-[540px] text-sm leading-relaxed text-secondary"
      >
        {t(
          'A familiar face for ongoing work. Pick a name and let your team join the conversation.',
        )}
      </motion.p>
      <motion.div variants={reveal} className="mt-8 flex flex-wrap items-center gap-2">
        <Button onClick={onCreate}>
          <Plus className="size-4" strokeWidth={1.8} />
          {t('New Bot')}
        </Button>
        <Button variant="secondary" onClick={onImport}>
          <Upload className="size-4" strokeWidth={1.8} />
          {t('Import from Grok Bot')}
        </Button>
      </motion.div>
    </motion.section>
  )
}
