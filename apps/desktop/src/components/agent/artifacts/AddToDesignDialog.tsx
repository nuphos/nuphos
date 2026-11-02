import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { requestFocus } from '../../../design/canvas/focusRequest'
import { boundsOf, genId } from '../../../design/canvas/helpers'
import { FRAME_PRESETS, usualFrameSize } from '../../../design/schema'
import { Modal } from '../../Modal'
import { Button } from '../../ui/button'
import { AppSelect } from '../../ui/select'
import { toast } from '../../ui/toast'
import { t } from '../../../i18n'

import type { ArtifactVersion } from './artifactPayload'
import type { Design, DesignFrame, DesignSummary, FramePreset } from '../../../design/schema'

const NEW_DESIGN = '__new__'

/** What a new screen on that page should measure, until someone picks another size. */
function sizeFor(design: Design | null, pageId: string): FramePreset {
  return usualFrameSize(design?.pages.find((p) => p.id === pageId))
}

/** The screen an artifact becomes, linked back to the version it came from. */
function artifactFrame(
  version: ArtifactVersion,
  sessionId: string | null,
  size: FramePreset,
): DesignFrame {
  return {
    id: genId(),
    type: 'frame',
    title: version.title,
    x: 0,
    y: 0,
    width: FRAME_PRESETS[size].width,
    height: FRAME_PRESETS[size].height,
    html: version.content,
    ...(sessionId
      ? {
          sourceArtifact: {
            sessionId,
            artifactId: version.artifactId,
            version: version.version,
          },
        }
      : {}),
  }
}

/** Put an HTML artifact on a design as a screen: pick the design and page, or start a new one. */
export function AddToDesignDialog({
  teamId,
  version,
  sessionId,
  onClose,
  onAdded,
}: {
  teamId: string
  version: ArtifactVersion
  sessionId: string | null
  onClose: () => void
  /** The design the screen landed on, so the caller can offer to open it. */
  onAdded: (design: { id: string; name: string }) => void
}) {
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null)
  const [designId, setDesignId] = useState(NEW_DESIGN)
  const [loaded, setLoaded] = useState<Design | null>(null)
  const [pickedPageId, setPickedPageId] = useState<string | null>(null)
  const [pickedSize, setPickedSize] = useState<FramePreset | null>(null)
  const [busy, setBusy] = useState(false)
  // The picked design once it has arrived; a stale one is never shown for the next pick.
  const design = loaded?.id === designId ? loaded : null
  const pageId =
    (design?.pages.some((p) => p.id === pickedPageId) ? pickedPageId : null) ??
    design?.pages[0]?.id ??
    ''
  const size = pickedSize ?? sizeFor(design, pageId)

  useEffect(() => {
    api
      .designsList(teamId)
      .then((list) => {
        setDesigns(list)
        if (list[0]) setDesignId(list[0].id)
      })
      .catch((e: unknown) => {
        setDesigns([])
        toast.apiError('Failed to load designs', e)
      })
  }, [teamId])

  useEffect(() => {
    if (designId === NEW_DESIGN) return
    let cancelled = false

    api
      .designsGet(teamId, designId)
      .then((d) => {
        if (!cancelled) setLoaded(d)
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.apiError('Failed to open design', e)
      })

    return () => {
      cancelled = true
    }
  }, [teamId, designId])

  const add = async () => {
    setBusy(true)
    try {
      const frame = artifactFrame(version, sessionId, size)

      if (designId === NEW_DESIGN || !design) {
        const created = await api.designsCreate(teamId, {
          name: version.title,
          pages: [{ id: 'p1', name: 'Page 1', objects: [frame], links: [] }],
        })

        onAdded({ id: created.id, name: created.name })
      } else {
        // Drop the new screen to the right of what the page already holds.
        const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0]

        if (!page) return
        const bounds = boundsOf(page.objects)
        const right = bounds ? bounds.x + bounds.width : 0

        await api.designsApplyOps(teamId, design.id, [
          {
            op: 'upsertObjects',
            pageId: page.id,
            objects: [{ ...frame, x: page.objects.length ? right + 120 : 0 }],
          },
        ])
        requestFocus(design.id, frame.id)
        onAdded({ id: design.id, name: design.name })
      }
      toast.success('Added to design', version.title)
      onClose()
    } catch (e) {
      toast.apiError('Failed to add to design', e)
    } finally {
      setBusy(false)
    }
  }

  const designOptions = [
    ...(designs ?? []).map((d) => ({ value: d.id, label: d.name })),
    { value: NEW_DESIGN, label: 'New design…' },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Add to design')}
      appearance="prompt"
      width={420}
      description={`“${version.title}” becomes a screen on the design, where you can arrange it beside the others.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || designs === null} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-secondary">
          Design
          <AppSelect
            value={designId}
            onValueChange={setDesignId}
            options={designOptions}
            disabled={designs === null}
            ariaLabel="Design"
          />
        </label>
        {design && design.pages.length > 1 && (
          <label className="flex flex-col gap-1 text-[12px] text-secondary">
            Page
            <AppSelect
              value={pageId}
              onValueChange={setPickedPageId}
              options={design.pages.map((p) => ({ value: p.id, label: p.name }))}
              ariaLabel="Page"
            />
          </label>
        )}
        <SizeSelect value={size} onChange={setPickedSize} />
      </div>
    </Modal>
  )
}

const SIZE_OPTIONS = Object.entries(FRAME_PRESETS).map(([value, p]) => ({
  value,
  label: `${p.label} ${String(p.width)}×${String(p.height)}`,
}))

function SizeSelect({
  value,
  onChange,
}: {
  value: FramePreset
  onChange: (size: FramePreset) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-secondary">
      {t('Size')}
      <AppSelect
        value={value}
        onValueChange={(next) => onChange(next as FramePreset)}
        options={SIZE_OPTIONS}
        ariaLabel={t('Size')}
      />
    </label>
  )
}
