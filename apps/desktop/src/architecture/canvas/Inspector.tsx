import { faTrashCan } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import { fieldClass } from '../../components/ui/input-group'
import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'

import { COLOR_SWATCHES, KIND_OPTIONS, PRIMARY, kindFromUrl } from './helpers'
import { btn, lbl } from './styles'

import type { Diagram, DiagramView } from '../schema'
import type { RefObject } from 'react'

type DiagramNode = Diagram['nodes'][number]

type Props = {
  node: DiagramNode
  view: DiagramView | undefined
  inspectorDirtyRef: RefObject<boolean>
  updateNode: (id: string, fn: (n: DiagramNode) => DiagramNode) => void
  setNodeColor: (id: string, color: string) => void
  deleteNode: (id: string) => void
}

export function Inspector({
  node,
  view,
  inspectorDirtyRef,
  updateNode,
  setNodeColor,
  deleteNode,
}: Props) {
  return (
    <div
      style={{
        width: 240,
        flex: 'none',
        borderLeft: '0.5px solid rgb(var(--color-border))',
        padding: 12,
        overflowY: 'auto',
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 10 }}>{t('Node')}</div>

      <label style={lbl}>{t('Label')}</label>
      <input
        value={node.label}
        onFocus={() => {
          inspectorDirtyRef.current = false
        }}
        onChange={(e) => updateNode(node.id, (n) => ({ ...n, label: e.target.value }))}
        className={`${fieldClass} mb-2.5 h-9`}
      />

      <label style={lbl}>{t('Kind')}</label>
      <div title={kindFromUrl(node.url) ? t('Determined by the link (concrete node)') : undefined}>
        <AppSelect
          value={kindFromUrl(node.url) ?? node.kind ?? 'abstract'}
          disabled={!!kindFromUrl(node.url)}
          onOpenChange={(open) => {
            if (open) inspectorDirtyRef.current = false
          }}
          onValueChange={(kind) => updateNode(node.id, (n) => ({ ...n, kind }))}
          options={KIND_OPTIONS.map((k) => ({ value: k, label: k }))}
          ariaLabel={t('Kind')}
          className="mb-2.5"
        />
      </div>

      <label style={lbl}>{t('Color (this view)')}</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {COLOR_SWATCHES.map((c) => {
          const active = (view?.nodeStyles?.[node.id]?.color ?? '') === c

          return (
            <button
              key={c || 'none'}
              onClick={() => setNodeColor(node.id, c)}
              title={c || t('Default')}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                background: c || 'transparent',
                border: active ? `2px solid ${PRIMARY}` : '1px solid rgb(var(--color-border))',
                cursor: 'default',
              }}
            >
              {c ? '' : '×'}
            </button>
          )
        })}
      </div>

      <label style={lbl}>{t('Link (open on double-click)')}</label>
      <input
        placeholder="https://nuphos.ai/teams/…"
        value={node.url ?? ''}
        onFocus={() => {
          inspectorDirtyRef.current = false
        }}
        onChange={(e) => updateNode(node.id, (n) => ({ ...n, url: e.target.value || undefined }))}
        className={`${fieldClass} mb-2.5 h-9`}
      />

      <button
        onClick={() => deleteNode(node.id)}
        style={{
          ...btn,
          width: '100%',
          gap: 6,
          marginTop: 8,
          color: 'rgb(var(--color-error))',
          justifyContent: 'center',
        }}
      >
        <FontAwesomeIcon icon={faTrashCan} className="w-4 h-4" /> {t('Delete node')}
      </button>
    </div>
  )
}
