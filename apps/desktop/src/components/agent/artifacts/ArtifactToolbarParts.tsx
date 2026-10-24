import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  MoreHorizontal,
  Wrench,
} from 'lucide-react'

import { Button } from '../../ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/menu'

import { copySource, downloadArtifact, fixPrompt } from './artifactActions'
import { artifactFileName } from './artifactPayload'

import type { ArtifactVersion } from './artifactPayload'
import type { ArtifactToolbarProps } from './ArtifactToolbar'

/** What a narrow dock folds away: the actions, and in a tiny one the versions and the fix. */
export function MoreMenu({
  density,
  line,
  current,
  errors,
  previous,
  next,
  view,
  onView,
  onStep,
  onAskAgent,
}: ArtifactToolbarProps & {
  previous: ArtifactVersion | undefined
  next: ArtifactVersion | undefined
}) {
  const tiny = density === 'tiny'

  return (
    <Menu>
      <MenuTrigger
        aria-label="More"
        title="More"
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-secondary outline-none transition-colors hover:bg-zGray-800 hover:text-main focus-visible:ring-2 focus-visible:ring-zViolet-accent data-[popup-open]:bg-zGray-800 data-[popup-open]:text-main"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
        {tiny && errors.length > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning"
          />
        )}
      </MenuTrigger>
      <MenuContent align="end" className="min-w-52">
        {tiny && current.kind !== 'code' && (
          <>
            <MenuItem
              icon={<Eye className="size-3.5" />}
              selected={view === 'preview'}
              onClick={() => onView('preview')}
            >
              Preview
            </MenuItem>
            <MenuItem
              icon={<Code2 className="size-3.5" />}
              selected={view === 'source'}
              onClick={() => onView('source')}
            >
              Code
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {tiny && line.length > 1 && (
          <>
            <MenuItem
              icon={<ChevronLeft className="size-3.5" />}
              disabled={!previous}
              onClick={() => previous && onStep(previous)}
            >
              Previous version
            </MenuItem>
            <MenuItem
              icon={<ChevronRight className="size-3.5" />}
              hint={`${String(current.version)} of ${String(line.length)}`}
              disabled={!next}
              onClick={() => next && onStep(next)}
            >
              Next version
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {tiny && errors.length > 0 && (
          <MenuItem
            icon={<Wrench className="size-3.5 text-warning" />}
            onClick={() => onAskAgent(fixPrompt(current, errors))}
          >
            Ask the agent to fix
          </MenuItem>
        )}
        <MenuItem icon={<Copy className="size-3.5" />} onClick={() => void copySource(current)}>
          Copy source
        </MenuItem>
        <MenuItem
          icon={<Download className="size-3.5" />}
          hint={artifactFileName(current)}
          onClick={() => void downloadArtifact(current)}
        >
          Download
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

export function VersionStepper({
  previous,
  next,
  current,
  total,
  short,
  onStep,
}: {
  previous: ArtifactVersion | undefined
  next: ArtifactVersion | undefined
  current: ArtifactVersion
  total: number
  short: boolean
  onStep: (version: ArtifactVersion) => void
}) {
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label="Versions">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous version"
        disabled={!previous}
        onClick={() => previous && onStep(previous)}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span
        className="whitespace-nowrap px-0.5 text-[12px] tabular-nums text-secondary"
        aria-live="polite"
        title={`Version ${String(current.version)} of ${String(total)}`}
      >
        {short
          ? `${String(current.version)}/${String(total)}`
          : `v${String(current.version)} of ${String(total)}`}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next version"
        disabled={!next}
        onClick={() => next && onStep(next)}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
