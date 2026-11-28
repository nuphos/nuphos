import clsx from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'
import { useRef, useState } from 'react'

import { Button } from '../../../components/ui/button'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { t } from '../../../i18n'
import { isMac, isWindows } from '../../../lib/platform'
import { useScannedRuntimes } from '../setup/runtimeScan'

import { AddRuntimePopover } from './AddRuntimePopover'
import { ArrivingBox } from './ArrivingBox'
import { botRuntimes } from './botRuntimes'
import { BotSwitch } from './BotSwitch'
import { BoxGiftModal } from './BoxGiftModal'
import { ComputerCard } from './ComputerCard'
import { Crossfade } from './Crossfade'
import { InstalledRuntimes, RuntimeTiles } from './LocalRuntimes'
import { FLIGHT, installedRuntimes, runtimeStatuses } from './runtimeStatuses'
import { useSequence } from './sequence'
import { TourLayout } from './TourLayout'
import './RuntimesPage.css'

import type { CSSProperties } from 'react'

/** This computer drawn as the Computers page draws a desktop Mac: the silver box. */
const THIS_COMPUTER = { form: 'box', brand: isMac ? 'apple' : 'other' } as const

/** The list's top margin (mt-5), part of the space the machines move into. */
const LIST_GAP = 20

/** The beat between the Box landing and Frida showing up. */
const SEAT_BEAT = 250

/**
 * Right after what Bots are: what a runtime is, and that it runs on a computer. This
 * computer shows as the Computers page shows it, the runtimes it has in its card and listed
 * underneath, and a square that lays the ones to add over that list. Next offers the computer
 * from Nuphos; claiming it moves the Box beside this one, for show only. From then on the
 * runtimes go at once, so the Box never flies over them, and it lands beside this computer in
 * the middle of the space the list held. Next then moves on.
 */
export function RuntimesPage({ onNext }: { onNext: () => void }) {
  const reduce = useReducedMotion() ?? false
  const state = useLocalRuntimeState()
  const scanned = useScannedRuntimes(Boolean(state?.detectionDisabled))
  const statuses = runtimeStatuses(state, scanned)
  const [adding, setAdding] = useState(false)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [offer, setOffer] = useState(false)
  // Where the dialog showed the Box, once claimed: the page's Box starts its flight there.
  const [claimed, setClaimed] = useState<DOMRect | null>(null)
  const [landed, setLanded] = useState(false)
  // A beat after both machines stand still side by side, Frida shows up between them.
  const [seated, setSeated] = useState(false)
  // Once it has landed the page says what the two machines are for; Next waits for that.
  const [introduced, setIntroduced] = useState(false)
  // A Bot starts work on this computer, then moves to the Box; Next shows once she has answered there.
  const [demoDone, setDemoDone] = useState(false)
  const [botOnBox, setBotOnBox] = useState(false)
  // How far the machines move down as the list goes: half the space it held.
  const [drop, setDrop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const { revealed } = useSequence(() => [
    // A beat before the page counts as shown.
    [1.6, () => null],
  ])

  let systemName = 'Linux'

  if (isMac) systemName = 'macOS'
  else if (isWindows) systemName = 'Windows'

  return (
    <TourLayout
      dot={1}
      title={
        <Crossfade
          swapped={landed}
          from={t('Your Bots work with runtimes')}
          to={t('Your Bots have their own computers')}
          onDone={() => setIntroduced(true)}
        />
      }
      subtitle={
        <Crossfade
          swapped={landed}
          from={t(
            'A runtime is the AI tool a Bot works with, like Claude Code or Codex. Here’s what this computer has.',
          )}
          to={t(
            'A free computer from us, or your own Mac or PC. The free one keeps working when your laptop is closed.',
          )}
        />
      }
      revealed={revealed && (!claimed || (introduced && demoDone))}
      actions={
        <>
          {/* Offers the Box until it's claimed, waits while it flies over, then moves on. */}
          <Button
            ref={nextRef}
            onClick={() => {
              if (claimed) {
                onNext()
              } else {
                setAdding(false)
                setOffer(true)
              }
            }}
          >
            {t('Next')}
          </Button>
          <BoxGiftModal
            open={offer}
            onClaim={(from) => {
              setDrop(((listRef.current?.offsetHeight ?? 0) + LIST_GAP) / 2)
              setClaimed(from)
              setOffer(false)
            }}
          />
        </>
      }
      art={
        <div
          className={clsx(
            'tour-runtimes flex flex-col items-center',
            claimed && 'is-settled',
            landed && (botOnBox ? 'is-bot-on-box' : 'is-bot-on-mac'),
          )}
          style={{ '--drop': `${drop}px` } as CSSProperties}
        >
          {/* Machines alone count toward the center; the gap leaves room for the Mac's card. */}
          <div className="tour-machines relative -mt-12 flex justify-center gap-[100px]">
            {/* Steps aside as the Box arrives, so the two stand together in the middle. */}
            <motion.div layout="position" transition={reduce ? { duration: 0 } : FLIGHT}>
              <ComputerCard
                model={THIS_COMPUTER}
                name={isMac ? t('This Mac') : t('This computer')}
                status={t('Online')}
                detail={systemName}
              >
                <RuntimeTiles
                  statuses={statuses}
                  adding={adding}
                  locked={Boolean(claimed)}
                  onAdd={() => setAdding((now) => !now)}
                />
              </ComputerCard>
            </motion.div>
            {claimed && (
              <ArrivingBox
                from={claimed}
                onLanded={() => {
                  setLanded(true)
                  window.setTimeout(() => setSeated(true), reduce ? 0 : SEAT_BEAT)
                }}
              />
            )}
            {seated && (
              <BotSwitch
                here={isMac ? t('This Mac') : t('This computer')}
                runtimes={botRuntimes(installedRuntimes(statuses))}
                onDone={() => setDemoDone(true)}
                onSide={setBotOnBox}
              />
            )}
          </div>
          {/* As tall as its rows; what can be added lies over it and moves nothing. Once gone, it
              still holds its space, so nothing below moves. */}
          <div
            ref={listRef}
            className="tour-runtime-list relative mt-5 w-[480px]"
            inert={Boolean(claimed)}
          >
            <InstalledRuntimes statuses={statuses} />
            <AddRuntimePopover
              open={adding && !claimed}
              statuses={statuses}
              limitRef={nextRef}
              onClose={() => setAdding(false)}
            />
          </div>
        </div>
      }
    />
  )
}
