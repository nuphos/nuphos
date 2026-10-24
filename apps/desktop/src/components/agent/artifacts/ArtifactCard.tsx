import { clsx } from 'clsx'
import { PanelRight } from 'lucide-react'
import { useEffect } from 'react'

import { useWorkspacePane } from '../../../app/workspace/WorkspacePaneContext'
import { artifactPagePath, pickArtifactVersion } from '../../../lib/sessionArtifacts'
import { MessageResponse } from '../MessageResponse'
import { LoadingText, ToolElapsedBadge } from '../panel/partChrome'
import { getToolLabel } from '../panel/toolPartUtils'
import { ToolPartView } from '../panel/ToolPartView'

import { ArtifactThumbnail } from './ArtifactFrame'
import { artifactKindLabel, parseArtifactPayload } from './artifactPayload'
import { svgDataUrl } from './artifactSandbox'
import { ARTIFACT_DOCUMENT_TYPE } from './artifactTypography'
import { useArtifactCall } from './useSessionArtifacts'

import type { ArtifactPayload } from './artifactPayload'
import type { OpenLink } from '../panel/LocalUrlChip'
import type { ToolPart } from '../panel/parts'

const CARD =
  'group/artifact relative w-full max-w-[520px] overflow-hidden rounded-xl border border-zGray-800 bg-main text-main transition-colors duration-150 hover:border-zGray-600 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-zViolet-accent has-[button:disabled]:hover:border-zGray-800 motion-reduce:transition-none'

/** Fades a clipped excerpt out at the bottom edge of the preview. */
const FADE = '[mask-image:linear-gradient(to_bottom,black_55%,transparent)]'

/** A call that finished this long ago or less is the agent at work, not history being read back. */
const LIVE_WINDOW_MS = 15_000
/** Versions already opened for the user once; the card remounts as the list virtualizes. */
const autoOpened = new Set<string>()

export function ArtifactToolPart({
  part,
  now,
  teamId,
  onOpen,
}: {
  part: ToolPart
  now: number
  teamId: string | undefined
  onOpen: OpenLink | undefined
}) {
  const payload = parseArtifactPayload(part.input)
  const done = part.state === 'output-available' || part.state === 'output-error'

  if (part.state === 'output-error') return <ToolPartView part={part} now={now} />
  if (!payload) {
    if (done) return <ToolPartView part={part} now={now} />

    return (
      <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[12.5px] text-tertiary">
        <LoadingText className="min-w-0 truncate text-left">{getToolLabel(part)}</LoadingText>
        <ToolElapsedBadge part={part} now={now} />
      </div>
    )
  }

  return <ArtifactCard part={part} payload={payload} done={done} teamId={teamId} onOpen={onOpen} />
}

function ArtifactCard({
  part,
  payload,
  done,
  teamId,
  onOpen,
}: {
  part: ToolPart
  payload: ArtifactPayload
  done: boolean
  teamId: string | undefined
  onOpen: OpenLink | undefined
}) {
  const call = useArtifactCall(part.toolCallId)
  const total = call?.line.length ?? 1
  const version = call?.line.find((entry) => entry.toolCallId === part.toolCallId)?.version ?? 1
  const latest = version === total
  const canOpen = Boolean(teamId && onOpen && call)

  const open = (follow: boolean) => {
    if (!teamId || !onOpen || !call) return
    pickArtifactVersion(call.sessionId, call.artifactId, follow ? null : version)
    onOpen(artifactPagePath(teamId, call.artifactId), false)
  }

  useOpenWhenMade(
    part,
    call && done && latest && canOpen
      ? `${call.sessionId}:${call.artifactId}:${String(version)}`
      : null,
    () => open(true),
  )
  const meta = versionMeta(artifactKindLabel(payload), version, total)

  return (
    <div className={CARD}>
      {latest && <ArtifactPreview payload={payload} />}
      <div className="flex items-center gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* The title is the card's one control; its hit area stretches over the whole card. */}
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => open(latest)}
            title={
              latest ? 'Open beside the chat' : `Open version ${String(version)} beside the chat`
            }
            className={clsx(
              "line-clamp-2 break-words text-left text-[15px] font-medium leading-5 outline-none after:absolute after:inset-0 after:content-[''] disabled:cursor-default",
              !latest && 'text-secondary',
            )}
          >
            {payload.title}
          </button>
          <span className="truncate text-[12.5px] leading-5 text-secondary">{meta}</span>
        </div>
        <span
          aria-hidden
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-zGray-800 px-2 text-[12px] leading-none text-secondary transition-colors duration-150 group-hover/artifact:bg-zGray-800/40 group-hover/artifact:text-main group-active/artifact:bg-zGray-800/60 group-has-[button:disabled]/artifact:opacity-50 motion-reduce:transition-none"
        >
          Open
          <PanelRight className="size-3" strokeWidth={1.75} />
        </span>
      </div>
    </div>
  )
}

/**
 * A version the agent just made opens beside the chat by itself, once, and
 * only in the pane the user is looking at. History read back stays closed.
 * `versionKey` names the version, not the call: the stored turn that replaces
 * the live one at the end of the turn gives the same call a new id.
 */
function useOpenWhenMade(part: ToolPart, versionKey: string | null, open: () => void) {
  const paneActive = useWorkspacePane()?.active ?? true
  const finishedAt = part.completedAt ?? part.startedAt

  useEffect(() => {
    if (!versionKey || !paneActive || finishedAt === undefined) return
    if (autoOpened.has(versionKey) || Date.now() - finishedAt > LIVE_WINDOW_MS) return
    autoOpened.add(versionKey)
    open()
    // `open` is rebuilt every render; the set above makes this run once per version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey, paneActive, finishedAt])
}

function versionMeta(kind: string, version: number, total: number): string {
  if (total === 1) return kind
  if (version === total) return `${kind} · Version ${String(version)}`

  return `${kind} · Version ${String(version)} of ${String(total)}`
}

/** The first screen of the artifact, the way it will look when opened. */
function ArtifactPreview({ payload }: { payload: ArtifactPayload }) {
  return (
    <span className="relative block aspect-[16/7] w-full overflow-hidden border-b border-zGray-800">
      {payload.kind === 'html' && (
        <ArtifactThumbnail html={payload.content} title={payload.title} />
      )}
      {payload.kind === 'svg' && (
        <span className="absolute inset-0 flex items-center justify-center bg-white p-5">
          <img
            src={svgDataUrl(payload.content)}
            alt=""
            className="m-0 max-h-full max-w-full object-contain"
            draggable={false}
          />
        </span>
      )}
      {payload.kind === 'markdown' && (
        <span
          aria-hidden
          inert
          className={clsx('absolute inset-0 block overflow-hidden bg-zGray-900/30 px-6 pt-5', FADE)}
        >
          <MessageResponse
            className={clsx(
              ARTIFACT_DOCUMENT_TYPE,
              'pointer-events-none origin-top-left scale-[0.7] [width:142.857%]',
            )}
          >
            {payload.content.slice(0, 2400)}
          </MessageResponse>
        </span>
      )}
      {payload.kind === 'code' && (
        <span
          aria-hidden
          className={clsx('absolute inset-0 block overflow-hidden bg-zGray-900/30', FADE)}
        >
          <pre className="m-0 px-4 py-3.5 font-mono text-[11.5px] leading-[18px] text-secondary">
            {payload.content.split('\n').slice(0, 14).join('\n')}
          </pre>
        </span>
      )}
    </span>
  )
}
