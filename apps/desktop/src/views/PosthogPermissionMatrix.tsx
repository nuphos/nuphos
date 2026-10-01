import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { AlertTriangle } from 'lucide-react'

import { Tooltip } from '../components/ui/tooltip'
import {
  detectPreset,
  normalizePermissions,
  POSTHOG_ACCESS_LABELS,
} from '../lib/posthogPermissions'

import type { PosthogAccess, PosthogPermissions, PosthogScopeCatalog } from '../types'

const LEVELS: PosthogAccess[] = ['none', 'read', 'write']

const SEGMENT_CLASS =
  'h-7 px-2.5 text-[11.5px] text-secondary outline-none transition-colors hover:text-main focus-visible:ring-2 focus-visible:ring-zViolet-accent data-[pressed]:bg-zViolet-500 data-[pressed]:text-white data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 inline-flex items-center gap-1'

const GROUP_CLASS =
  'inline-flex overflow-hidden rounded-md border border-zGray-800 divide-x divide-zGray-800'

export function PosthogPermissionMatrix({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: PosthogScopeCatalog
  value: PosthogPermissions
  onChange: (value: PosthogPermissions) => void
  disabled?: boolean
}) {
  const preset = detectPreset(catalog, value)
  const presetOptions = [
    ...catalog.presets.map((item) => ({ id: item.id, label: item.label })),
    { id: 'custom', label: 'Custom' },
  ]

  function applyPreset(id: string) {
    const match = catalog.presets.find((item) => item.id === id)

    if (match) onChange(normalizePermissions(catalog, match.permissions))
  }

  return (
    <div className="space-y-2">
      <ToggleGroup
        value={[preset]}
        onValueChange={(next) => {
          if (next[0]) applyPreset(next[0])
        }}
        disabled={disabled}
        className={GROUP_CLASS}
        aria-label="Permission preset"
      >
        {presetOptions.map((option) => (
          <Toggle
            key={option.id}
            value={option.id}
            disabled={option.id === 'custom'}
            className={SEGMENT_CLASS}
          >
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      <div className="rounded-md border border-zGray-800">
        <div className="px-3 py-2 text-[11px] text-tertiary border-b border-zGray-800">
          Always requested: <span className="font-mono">{catalog.fixedScopes.join(', ')}</span>
        </div>
        {catalog.resources.map((resource, index) => (
          <PermissionRow
            key={resource.id}
            resource={resource}
            level={value[resource.id] ?? 'none'}
            onLevelChange={(level) => onChange({ ...value, [resource.id]: level })}
            disabled={disabled}
            bordered={index > 0}
          />
        ))}
      </div>
    </div>
  )
}

function PermissionRow({
  resource,
  level,
  onLevelChange,
  disabled,
  bordered,
}: {
  resource: PosthogScopeCatalog['resources'][number]
  level: PosthogAccess
  onLevelChange: (level: PosthogAccess) => void
  disabled?: boolean
  bordered: boolean
}) {
  return (
    <div className={`px-3 py-2 ${bordered ? 'border-t border-zGray-800/60' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-main">{resource.label}</div>
          <div className="text-[11px] text-tertiary leading-snug">{resource.description}</div>
        </div>
        <ToggleGroup
          value={[level]}
          onValueChange={(next) => {
            const picked = next[0] as PosthogAccess | undefined

            if (picked) onLevelChange(picked)
          }}
          disabled={disabled}
          className={GROUP_CLASS}
          aria-label={`${resource.label} access`}
        >
          {LEVELS.map((option) => (
            <Toggle
              key={option}
              value={option}
              disabled={option === 'write' && !resource.writable}
              className={SEGMENT_CLASS}
            >
              {POSTHOG_ACCESS_LABELS[option]}
              {option === 'write' && resource.writeWarning && (
                <Tooltip content={resource.writeWarning}>
                  <AlertTriangle className="h-3 w-3 text-warning" aria-label="Warning" />
                </Tooltip>
              )}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      {level === 'write' && resource.writeWarning && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
          {resource.writeWarning}
        </div>
      )}
    </div>
  )
}
