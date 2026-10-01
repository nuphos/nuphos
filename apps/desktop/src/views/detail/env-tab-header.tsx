import clsx from 'clsx'
import { Plus } from 'lucide-react'

import { deploymentEnvContainerKey } from './env-model'

import type { DeploymentEnvContainer } from '../../types'

export function EnvTabHeader({
  containers,
  selectedKey,
  dirtyKeys,
  unsavedStatus,
  embedded,
  saving,
  changed,
  onSelect,
  onAddEnv,
  onAddEnvFrom,
  onSave,
}: {
  containers: DeploymentEnvContainer[]
  selectedKey: string
  dirtyKeys: Set<string>
  unsavedStatus: string | null
  embedded: boolean
  saving: boolean
  changed: boolean
  onSelect: (key: string) => void
  onAddEnv: () => void
  onAddEnvFrom: () => void
  onSave: () => void
}) {
  return (
    <div
      className={clsx(
        'z-10 border-b border-zGray-800 py-2.5',
        embedded ? 'bg-transparent px-6' : 'sticky top-0 bg-zGray-900 px-6',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {containers.map((container) => {
            const key = deploymentEnvContainerKey(container)
            const dirty = dirtyKeys.has(key)
            const label = `${container.type === 'initContainers' ? 'Init: ' : ''}${container.name}`

            return (
              <button
                key={key}
                type="button"
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  onSelect(key)
                }}
                onClick={(event) => {
                  if (event.detail !== 0) return
                  onSelect(key)
                }}
                className={clsx(
                  'inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded px-2.5 text-[12px]',
                  selectedKey === key
                    ? 'bg-zViolet-500/20 text-zViolet-accent'
                    : 'text-secondary hover:bg-zGray-800 hover:text-main',
                )}
                title={dirty ? `${label} - Unsaved changes` : (container.image ?? container.name)}
              >
                <span className="min-w-0 truncate">{label}</span>
                {dirty && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warning"
                  />
                )}
              </button>
            )
          })}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {unsavedStatus && (
            <div
              className="hidden items-center gap-1.5 text-[12px] text-warning @sm:inline-flex"
              title={unsavedStatus}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
              <span>{unsavedStatus}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onAddEnv}
            className="inline-flex h-7 items-center gap-1.5 rounded bg-zGray-800 px-2.5 text-[12px] text-main hover:bg-zGray-750"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Env
          </button>
          <button
            type="button"
            onClick={onAddEnvFrom}
            className="inline-flex h-7 items-center gap-1.5 rounded bg-zGray-800 px-2.5 text-[12px] text-main hover:bg-zGray-750"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            EnvFrom
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!changed || saving}
            className="inline-flex h-7 items-center rounded bg-zViolet-500 px-3 text-[12px] font-medium text-white hover:bg-zViolet-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zViolet-500"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
