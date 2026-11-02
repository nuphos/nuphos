import { NodeResizer } from '@xyflow/react'

import { t } from '../../i18n'

import { useDesignCanvas } from './context'
import { PRIMARY } from './helpers'
import { EditableTitle } from './nodeParts'
import { useScreenScale } from './useScreenScale'

import type { DesignNodeData } from './nodeParts'
import type { DesignSection } from '../schema'
import type { NodeProps } from '@xyflow/react'

// --- Section ----------------------------------------------------------------

export function SectionNode({ data, selected }: NodeProps) {
  const { object: section } = data as DesignNodeData<DesignSection>
  const canvas = useDesignCanvas()
  const scale = useScreenScale()
  const color = section.color || 'rgb(var(--color-zViolet-accent))'

  return (
    <div
      className="h-full w-full rounded-xl"
      style={{
        border: selected ? `2px solid ${PRIMARY}` : `1.5px dashed ${color}`,
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
        boxSizing: 'border-box',
      }}
    >
      <NodeResizer
        isVisible={selected}
        color={PRIMARY}
        minWidth={160}
        minHeight={120}
        onResizeEnd={(_e, p) =>
          canvas.updateObject(
            section.id,
            (o) => ({ ...o, x: p.x, y: p.y, width: p.width, height: p.height }),
            { record: true },
          )
        }
      />
      <div
        className="absolute left-0 flex cursor-grab items-center gap-2 whitespace-nowrap text-[13px] font-medium"
        style={{
          bottom: '100%',
          marginBottom: 4 * scale,
          transform: `scale(${String(scale)})`,
          transformOrigin: 'bottom left',
          color,
          pointerEvents: 'auto',
        }}
      >
        <EditableTitle
          value={section.title}
          placeholder={t('Section')}
          onChange={(title) =>
            canvas.updateObject(section.id, (o) => ({ ...o, title }), { record: true })
          }
        />
      </div>
    </div>
  )
}
