import { Loader2, Play, RotateCcw } from 'lucide-react'

import { JsonEditor } from '../../components/YamlEditor'

import { operationAction } from './documentsQuery'

import type { QueryOperation } from './documentsQuery'

export function DocumentsQueryBar({
  operation,
  filter,
  projection,
  sort,
  pipeline,
  limit,
  loading,
  notice,
  error,
  onFilterChange,
  onProjectionChange,
  onSortChange,
  onPipelineChange,
  onLimitChange,
  onRun,
  onReset,
}: {
  operation: QueryOperation
  filter: string
  projection: string
  sort: string
  pipeline: string
  limit: number
  loading: boolean
  notice: string | null
  error: string | null
  onFilterChange: (value: string) => void
  onProjectionChange: (value: string) => void
  onSortChange: (value: string) => void
  onPipelineChange: (value: string) => void
  onLimitChange: (value: number) => void
  onRun: () => void
  onReset: () => void
}) {
  const runButtons = (
    <div className="flex gap-1 pt-[19px]">
      <button
        onClick={onRun}
        disabled={loading}
        className="flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {operationAction(operation)}
      </button>
      <button
        onClick={onReset}
        title="Reset query"
        className="h-8 rounded-md border border-zGray-700 px-2 text-tertiary hover:text-main"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  )
  const limitField = (
    <label className="w-20">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-tertiary">
        Limit
      </span>
      <input
        type="number"
        min={1}
        max={100}
        value={limit}
        onChange={(event) =>
          onLimitChange(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
        }
        className="h-8 w-full rounded-md border border-zGray-700 bg-field px-2 text-[12px] text-main outline-none focus:border-zViolet-500"
      />
    </label>
  )

  return (
    <div className="border-b border-zGray-800 bg-zGray-900/35 p-3">
      {operation === 'aggregate' ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-tertiary">
              Pipeline · JSON array
            </span>
            <JsonEditor
              value={pipeline}
              onChange={onPipelineChange}
              minimap={false}
              className="h-40 overflow-hidden rounded-md border border-zGray-700 focus-within:border-zViolet-500"
            />
          </div>
          {limitField}
          {runButtons}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-tertiary">
              Filter
            </span>
            <JsonEditor
              value={filter}
              onChange={onFilterChange}
              minimap={false}
              lineNumbers="off"
              wordWrap="on"
              className="h-[70px] overflow-hidden rounded-md border border-zGray-700 focus-within:border-zViolet-500"
            />
          </div>
          {operation !== 'count' && (
            <>
              <div className="w-44">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-tertiary">
                  Project
                </span>
                <JsonEditor
                  value={projection}
                  onChange={onProjectionChange}
                  minimap={false}
                  lineNumbers="off"
                  wordWrap="on"
                  className="h-[70px] overflow-hidden rounded-md border border-zGray-700 focus-within:border-zViolet-500"
                />
              </div>
              <div className="w-40">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-tertiary">
                  Sort
                </span>
                <JsonEditor
                  value={sort}
                  onChange={onSortChange}
                  minimap={false}
                  lineNumbers="off"
                  wordWrap="on"
                  className="h-[70px] overflow-hidden rounded-md border border-zGray-700 focus-within:border-zViolet-500"
                />
              </div>
            </>
          )}
          {operation !== 'count' && limitField}
          {runButtons}
        </div>
      )}
      {notice && (
        <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          {error}
        </div>
      )}
    </div>
  )
}
