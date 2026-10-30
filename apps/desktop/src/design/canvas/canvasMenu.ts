import { Bot, ClipboardPaste, Copy, Download, Play, Trash2 } from 'lucide-react'

import { hasClipboard } from './clipboard'
import { downloadHtml } from './helpers'

import type { ContextMenuItem } from '../../components/ContextMenu'
import type { Design, DesignFrame, DesignPage } from '../schema'

type MenuArgs = {
  pane: boolean
  selectedFrames: DesignFrame[]
  canAskAgent: boolean
  onAskAgent: () => void
  onPlay: (frameId: string) => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/** The right-click menu: on the empty canvas, or on whatever is selected. */
export function canvasMenuItems(a: MenuArgs): ContextMenuItem[] {
  if (a.pane) {
    return [
      {
        key: 'paste',
        label: 'Paste',
        icon: ClipboardPaste,
        disabled: !hasClipboard(),
        onSelect: a.onPaste,
      },
    ]
  }
  const frames = a.selectedFrames
  const items: ContextMenuItem[] = []

  if (a.canAskAgent && frames.length > 0) {
    items.push({ key: 'ask', label: 'Ask agent to edit…', icon: Bot, onSelect: a.onAskAgent })
  }
  if (frames.length === 1) {
    items.push({
      key: 'play',
      label: 'Play from here',
      icon: Play,
      onSelect: () => a.onPlay(frames[0]!.id),
    })
  }
  if (frames.length > 0) {
    items.push({
      key: 'download',
      label: frames.length === 1 ? 'Download HTML' : `Download ${String(frames.length)} screens`,
      icon: Download,
      onSelect: () => {
        for (const f of frames) downloadHtml(f.title, f.html)
      },
    })
  }
  if (items.length > 0) items.push({ key: 'sep', separator: true })
  items.push(
    { key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: a.onDuplicate },
    { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: a.onDelete },
  )

  return items
}

/** What the chat is told so the agent can edit exactly these screens through the API. */
export function askAgentPrompt(args: {
  teamId: string
  design: Design
  page: DesignPage
  frames: DesignFrame[]
  request: string
}): string {
  const screens = args.frames.map((f) => `- "${f.title}" (frame id ${f.id})`).join('\n')

  return (
    `Use the design-canvas skill. Edit the design "${args.design.name}" (design id ${args.design.id}, team ${args.teamId}), ` +
    `page "${args.page.name}" (page id ${args.page.id}).\n` +
    (screens ? `Screens to change:\n${screens}\n\n` : '\n') +
    `Request: ${args.request.trim()}\n\n` +
    'GET the design first, then upsert the changed frames with their full new html through the designs ops API. Keep their ids and positions.'
  )
}
