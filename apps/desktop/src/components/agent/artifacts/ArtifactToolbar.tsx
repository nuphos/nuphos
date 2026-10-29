import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Code2, Copy, Download, Eye, Wrench } from 'lucide-react'
import { createPortal } from 'react-dom'

import { useToolbarSlot } from '../../../hooks/useToolbarControls'
import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { Tooltip } from '../../ui/tooltip'

import { copySource, downloadArtifact, fixPrompt } from './artifactActions'
import { artifactFileName, artifactKindLabel } from './artifactPayload'
import { ArtifactShareButton } from './ArtifactShareButton'
import { MoreMenu, VersionStepper } from './ArtifactToolbarParts'

import type { ArtifactVersion } from './artifactPayload'
import type { ToolbarDensity } from './toolbarDensity'

export type ArtifactViewMode = 'preview' | 'source'

export type { ToolbarDensity } from './toolbarDensity'

const SEGMENT =
  'inline-flex h-[26px] w-8 items-center justify-center text-secondary outline-none transition-colors hover:text-main focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent data-[pressed]:bg-zGray-800 data-[pressed]:text-main'

export type ArtifactToolbarProps = {
  active: boolean
  density: ToolbarDensity
  line: readonly ArtifactVersion[]
  current: ArtifactVersion
  view: ArtifactViewMode
  errors: string[]
  /** The teammate link to this version; null when the chat isn't known yet. */
  link: string | null
  onView: (view: ArtifactViewMode) => void
  onStep: (version: ArtifactVersion) => void
  onAskAgent: (prompt: string) => void
}

/** The title takes whatever room is left, so it is the last thing to shorten. */
export function ArtifactToolbar(props: ArtifactToolbarProps) {
  const { active, density, line, current, errors, onAskAgent } = props
  const leftSlot = useToolbarSlot('left', active)
  const rightSlot = useToolbarSlot('right', active)
  const steps = stepsOf(line, current)

  return (
    <>
      {leftSlot &&
        createPortal(
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className="min-w-[3rem] truncate text-[13px] font-medium text-main"
              title={current.title}
            >
              {current.title}
            </span>
            {density !== 'tiny' && line.length > 1 && (
              <VersionStepper
                {...steps}
                current={current}
                total={line.length}
                short={density === 'compact'}
                onStep={props.onStep}
              />
            )}
          </div>,
          leftSlot,
        )}
      {rightSlot &&
        createPortal(
          <div className="flex shrink-0 items-center gap-1">
            {density !== 'tiny' && errors.length > 0 && (
              <Tooltip
                content={t('Ask the agent to fix: {errors}', { errors: errors.join(' · ') })}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative h-7 w-7 text-warning hover:text-warning"
                  aria-label={
                    errors.length === 1
                      ? t('Ask the agent to fix 1 error')
                      : t('Ask the agent to fix {n} errors', { n: String(errors.length) })
                  }
                  onClick={() => onAskAgent(fixPrompt(current, errors))}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning"
                  />
                </Button>
              </Tooltip>
            )}
            {density !== 'tiny' && current.kind !== 'code' && (
              <ViewToggle view={props.view} onView={props.onView} />
            )}
            {density === 'full' ? (
              <InlineActions current={current} />
            ) : (
              <MoreMenu {...props} {...steps} />
            )}
            <ArtifactShareButton
              current={current}
              link={props.link}
              iconOnly={density !== 'full'}
            />
          </div>,
          rightSlot,
        )}
    </>
  )
}

function stepsOf(line: readonly ArtifactVersion[], current: ArtifactVersion) {
  const index = line.indexOf(current)

  return {
    previous: index > 0 ? line.at(index - 1) : undefined,
    next: line.at(index + 1),
  }
}

function ViewToggle({
  view,
  onView,
}: {
  view: ArtifactViewMode
  onView: (view: ArtifactViewMode) => void
}) {
  return (
    <ToggleGroup
      value={[view]}
      onValueChange={(value) => {
        const chosen = value[0] as ArtifactViewMode | undefined

        if (chosen) onView(chosen)
      }}
      aria-label={t('Show')}
      className="mr-1 inline-flex shrink-0 divide-x divide-zGray-800 overflow-hidden rounded-md border border-zGray-800"
    >
      <Tooltip content={t('Preview')}>
        <Toggle value="preview" aria-label={t('Preview')} className={SEGMENT}>
          <Eye className="h-3.5 w-3.5" />
        </Toggle>
      </Tooltip>
      <Tooltip content={t('Code')}>
        <Toggle value="source" aria-label={t('Code')} className={SEGMENT}>
          <Code2 className="h-3.5 w-3.5" />
        </Toggle>
      </Tooltip>
    </ToggleGroup>
  )
}

function InlineActions({ current }: { current: ArtifactVersion }) {
  return (
    <>
      <Tooltip
        content={t('Copy the {kind} source', { kind: artifactKindLabel(current).toLowerCase() })}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          aria-label={t('Copy')}
          onClick={() => void copySource(current)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content={t('Download {fileName}', { fileName: artifactFileName(current) })}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1 h-7 w-7"
          aria-label={t('Download')}
          onClick={() => void downloadArtifact(current)}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
    </>
  )
}
