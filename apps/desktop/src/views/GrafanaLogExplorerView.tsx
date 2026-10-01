import { ArrowLeft, Loader2, MessageSquare, Play, Plus, Radio, Search, X } from 'lucide-react'

import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { InputGroup, InputGroupInput } from '../components/ui/input-group'
import { AppSelect } from '../components/ui/select'
import { LogsPanel } from '../grafana/components/LogsPanel'

import { RANGE_OPTIONS } from './grafana-log/logql'
import { useLogExplorer } from './grafana-log/useLogExplorer'

import type { DatasourceSummary, GrafanaTarget } from '../grafana/client'

type Props = {
  target: GrafanaTarget
  datasource: DatasourceSummary
  onBack: () => void
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function GrafanaLogExplorerView({ target, datasource, onBack, onOpenAgentChat }: Props) {
  const {
    labels,
    filters,
    setFilters,
    keyword,
    setKeyword,
    rangeMs,
    setRangeMs,
    maxLines,
    setMaxLines,
    frames,
    loading,
    live,
    setLive,
    labelValues,
    composingRef,
    filterIdRef,
    expr,
    runQuery,
    onKeywordKeyDown,
    updateFilter,
    askAgent,
  } = useLogExplorer({ target, datasource, onOpenAgentChat })

  const usedNames = new Set(filters.map((f) => f.name).filter(Boolean))
  // Loaded-but-empty: the tenant has no log streams in range, so no query can
  // ever match — surface that instead of an empty dropdown and a runnable Run.
  const noLabels = labels !== null && labels.length === 0

  return (
    <div className="h-full flex flex-col min-h-0">
      <PageHeader
        title="Log Explorer"
        subtitle={`${datasource.name} · ${datasource.uid}`}
        actions={
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
            Datasources
          </Button>
        }
      />

      <div className="border-b border-zGray-800/60 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {filters.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5">
              <AppSelect
                value={f.name}
                onValueChange={(name) => updateFilter(f.id, { name, value: '' })}
                ariaLabel="Log label name"
                placeholder={labels === null ? 'Loading…' : noLabels ? 'No labels' : 'Label'}
                disabled={labels === null || noLabels}
                triggerClassName="h-8 min-w-[120px] border-zGray-800 bg-zGray-900 px-2 text-[12.5px]"
                options={(labels ?? [])
                  .filter((name) => name === f.name || !usedNames.has(name))
                  .map((name) => ({ value: name, label: name }))}
              />
              <span className="text-tertiary text-[12.5px]">=</span>
              <AppSelect
                value={f.value}
                onValueChange={(value) => updateFilter(f.id, { value })}
                ariaLabel="Log label value"
                placeholder={
                  f.name && labelValues[f.name] === undefined
                    ? 'Loading…'
                    : f.name && labelValues[f.name]?.length === 0
                      ? 'No values'
                      : 'Value'
                }
                disabled={!f.name || !labelValues[f.name]?.length}
                triggerClassName="h-8 min-w-[160px] border-zGray-800 bg-zGray-900 px-2 text-[12.5px] font-mono"
                options={(labelValues[f.name] ?? []).map((v) => ({ value: v, label: v }))}
              />
              {filters.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1.5"
                  onClick={() => setFilters((cur) => cur.filter((x) => x.id !== f.id))}
                  aria-label="Remove label filter"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilters((cur) => [...cur, { id: filterIdRef.current++, name: '', value: '' }])
            }
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
            Label
          </Button>
          {expr && (
            <span
              className="ml-auto min-w-0 truncate font-mono text-[11.5px] text-tertiary selectable"
              title={expr}
            >
              {expr}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <InputGroup className="flex-1 flex items-center gap-2 h-8 px-2.5 rounded-md bg-zGray-900 border border-zGray-800 transition-colors min-w-0">
            <Search className="w-3.5 h-3.5 text-tertiary flex-shrink-0" strokeWidth={1.8} />
            <InputGroupInput
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={onKeywordKeyDown}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              placeholder="Contains keyword, e.g. timeout"
              className="text-[12.5px] text-main placeholder:text-tertiary font-mono"
            />
          </InputGroup>
          <AppSelect
            value={String(rangeMs)}
            onValueChange={(nextValue) => setRangeMs(Number(nextValue))}
            ariaLabel="Log search range"
            triggerClassName="h-8 w-[72px] border-zGray-800 bg-zGray-900 px-2 text-[12.5px]"
            options={RANGE_OPTIONS.map((option) => ({
              value: String(option.ms),
              label: option.label,
            }))}
          />
          <input
            type="number"
            min={10}
            max={1000}
            value={maxLines}
            onChange={(e) =>
              setMaxLines(Math.max(10, Math.min(1000, Number(e.target.value) || 10)))
            }
            className="h-8 w-16 bg-zGray-900 border border-zGray-800 rounded-md px-2 text-[12.5px] text-main outline-none focus:border-zViolet-500"
            aria-label="Max log lines"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLive((cur) => !cur)}
            className={
              live ? 'border-zViolet-500/60 bg-zViolet-500/15 text-zViolet-300' : undefined
            }
            title="Re-run the query every few seconds"
          >
            <Radio className="w-3.5 h-3.5" strokeWidth={1.8} />
            Live
          </Button>
          {onOpenAgentChat && (
            <Button
              variant="secondary"
              size="sm"
              onClick={askAgent}
              disabled={!expr}
              title="Prefill the agent with this query context"
            >
              <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.8} />
              Ask Agent
            </Button>
          )}
          <Button size="sm" onClick={() => void runQuery()} disabled={loading || !expr}>
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="w-3.5 h-3.5" strokeWidth={2} />
            )}
            Run
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {frames === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12.5px]">
            {loading
              ? 'Loading logs…'
              : noLabels
                ? 'This Loki datasource has no log streams — nothing has pushed logs to it yet.'
                : 'Pick label filters and press Run'}
          </div>
        ) : (
          <LogsPanel frames={frames} />
        )}
      </div>
    </div>
  )
}
