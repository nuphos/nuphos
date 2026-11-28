import { motion, useReducedMotion } from 'framer-motion'
import { useRef } from 'react'

import { api } from '../../../api'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'
import { isMac } from '../../../lib/platform'
import { DeskArt } from '../../settings/BoxDesk'

import { PoweredByInstaBox } from './PoweredByInstaBox'
import { BOX_MODEL } from './runtimeStatuses'

/**
 * Offers the computer Nuphos gives them, over the runtimes page. Claiming is its one way out:
 * no X, Escape or click outside skips it. Claiming here only shows it: `onClaim` gets where the
 * Box stands, so the page can move it beside this computer. Nothing starts or is claimed, and
 * the tour does not move on.
 */
export function BoxGiftModal({
  open,
  onClaim,
}: {
  open: boolean
  onClaim: (from: DOMRect) => void
}) {
  const reduce = useReducedMotion() ?? false
  const art = useRef<HTMLDivElement>(null)
  const title = t('Nuphos also gives you a computer')

  return (
    <Modal
      open={open}
      closeOnBackdrop={false}
      title={title}
      titleHidden
      headerDivider={false}
      width={400}
      focusFirstControl={false}
    >
      <div className="flex flex-col items-center px-6 pb-6 text-center">
        {/* The facing Box draws well below its own top; only its visible part takes room. Its
            art sits a little right, as the Computers page leaves room for a card on that side. */}
        <div className="relative h-[150px] w-full">
          <motion.div
            className="absolute left-1/2 top-[-96px] -ml-[114px]"
            initial={reduce ? false : { opacity: 0, scale: 0.94 }}
            animate={open ? { opacity: 1, scale: 1 } : undefined}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div ref={art} className="w-[300px]">
              <DeskArt model={BOX_MODEL} on facing />
            </div>
          </motion.div>
        </div>
        <h2 className="mt-4 text-[19px] font-semibold text-primary">{title}</h2>
        <p className="mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-secondary">
          {isMac
            ? t('Besides this Mac, your Bots can also work on this one.')
            : t('Besides this computer, your Bots can also work on this one.')}
        </p>
        <div className="mt-2">
          <PoweredByInstaBox onOpen={(url) => void api.appOpenExternal(url)} />
        </div>
        <Button
          className="mt-5 w-full"
          onClick={() => {
            const from = art.current?.getBoundingClientRect()

            if (from) onClaim(from)
          }}
        >
          {t('Claim computer')}
        </Button>
      </div>
    </Modal>
  )
}
