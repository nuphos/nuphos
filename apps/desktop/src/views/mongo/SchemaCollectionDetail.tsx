import { KeyRound } from 'lucide-react'

import { MongoDocumentsExplorer } from '../MongoDocumentsExplorer'

import { CenteredLoader, EmptyDetail, JsonPanel, Metric, SafetyNotice } from './schemaShared'

import type { DetailTab } from './schemaFormat'
import type { MongoCollectionDetail } from '../../types'

export function CollectionDetail({
  teamId,
  connectionId,
  detail,
  loading,
  tab,
  onTab,
}: {
  teamId: string
  connectionId: string
  detail: MongoCollectionDetail | null
  loading: boolean
  tab: DetailTab
  onTab: (tab: DetailTab) => void
}) {
  if (loading || !detail) return <CenteredLoader />
  const detailTabs: DetailTab[] = [
    'Documents',
    'Schema',
    'Indexes',
    'Validation',
    ...(detail.view ? ['View' as const] : []),
    'Sharding',
    'Options',
  ]

  return (
    <div className="h-[508px] overflow-hidden">
      <div className="flex h-10 items-end gap-1 border-b border-zGray-800 px-4">
        {detailTabs.map((item) => (
          <button
            key={item}
            onClick={() => onTab(item)}
            className={`border-b-2 px-3 py-2 text-[11.5px] ${tab === item ? 'border-zViolet-accent text-main' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            {item}
            {item === 'Indexes' ? ` (${String(detail.indexes.length)})` : ''}
          </button>
        ))}
      </div>
      <div className={`h-[468px] ${tab === 'Documents' ? 'overflow-hidden' : 'overflow-auto p-4'}`}>
        {tab !== 'Documents' && detail.metadataTruncated && (
          <SafetyNotice text="Some collection metadata was omitted to stay within the backend response safety budget." />
        )}
        {tab === 'Documents' && (
          <MongoDocumentsExplorer
            teamId={teamId}
            connectionId={connectionId}
            database={detail.database}
            collection={detail.name}
          />
        )}
        {tab === 'Schema' && <SchemaTab detail={detail} />}
        {tab === 'Indexes' && <IndexesTab detail={detail} />}
        {tab === 'Validation' && <ValidationTab detail={detail} />}
        {tab === 'View' && detail.view && <ViewTab detail={detail} />}
        {tab === 'Sharding' && <ShardingTab detail={detail} />}
        {tab === 'Options' && <JsonPanel value={detail.options} empty="No collection options." />}
      </div>
    </div>
  )
}

function SchemaTab({ detail }: { detail: MongoCollectionDetail }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-[10.5px] text-tertiary">
        <span className="rounded bg-zGray-800 px-2 py-1">
          Sampled {detail.schema.sampleSize} documents
        </span>
        <span className="rounded bg-zGray-800 px-2 py-1">
          {detail.schema.fields.length} field paths
        </span>
        {detail.schema.truncated && (
          <span className="rounded bg-warning/10 px-2 py-1 text-warning">Field limit reached</span>
        )}
      </div>
      {detail.schema.fields.length === 0 ? (
        <EmptyDetail text="No fields could be sampled from this collection." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zGray-800">
          <table className="w-full text-left text-[11.5px]">
            <thead className="bg-zGray-900 text-tertiary">
              <tr>
                <th className="px-3 py-2 font-medium">Field path</th>
                <th className="px-3 py-2 font-medium">Types</th>
                <th className="px-3 py-2 font-medium">Presence</th>
              </tr>
            </thead>
            <tbody>
              {detail.schema.fields.map((field) => (
                <tr key={field.path} className="border-t border-zGray-800/70">
                  <td className="px-3 py-2 font-mono text-secondary">{field.path}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {field.types.map((type) => (
                        <span
                          key={type.type}
                          className="rounded bg-zViolet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-zViolet-accent"
                        >
                          {type.type} · {type.count}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-secondary">
                    {Math.round(field.presence * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function IndexesTab({ detail }: { detail: MongoCollectionDetail }) {
  if (detail.indexes.length === 0)
    return <EmptyDetail text="Index metadata is unavailable for this collection." />

  return (
    <div className="space-y-2">
      {detail.indexesTruncated && <SafetyNotice text="Only the first 200 indexes are shown." />}
      {detail.indexes.map((index) => (
        <div key={index.name} className="rounded-lg border border-zGray-800 p-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-zViolet-accent" />
            <span className="text-[12px] font-medium text-main">{index.name}</span>
          </div>
          <pre className="mt-2 overflow-x-auto rounded bg-zGray-900 px-2.5 py-2 text-[10.5px] text-secondary">
            {JSON.stringify(index.keys, null, 2)}
          </pre>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              index.unique && 'unique',
              index.sparse && 'sparse',
              index.hidden && 'hidden',
              index.partial && 'partial',
              index.collation && 'collation',
              index.expireAfterSeconds !== null && `TTL ${String(index.expireAfterSeconds)}s`,
            ]
              .filter(Boolean)
              .map((property) => (
                <span
                  key={String(property)}
                  className="rounded bg-zGray-800 px-1.5 py-0.5 text-[9.5px] text-tertiary"
                >
                  {property}
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ValidationTab({ detail }: { detail: MongoCollectionDetail }) {
  return (
    <div>
      {detail.validation.truncated && (
        <SafetyNotice text="The validator was truncated by the metadata safety budget." />
      )}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric label="Validation level" value={detail.validation.level ?? 'Default'} />
        <Metric label="Validation action" value={detail.validation.action ?? 'Default'} />
      </div>
      <JsonPanel value={detail.validation.validator} empty="No validator configured." />
    </div>
  )
}

function ViewTab({ detail }: { detail: MongoCollectionDetail }) {
  if (!detail.view) return <EmptyDetail text="This collection is not a view." />

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric label="Source collection" value={detail.view.source} />
        <Metric label="Pipeline stages" value={String(detail.view.pipeline.length)} />
      </div>
      <SafetyNotice text="Pipeline structure is shown for discovery. Sensitive keys and non-structural literal values are redacted by the backend." />
      {detail.view.pipelineTruncated && (
        <SafetyNotice text="The pipeline was truncated by the metadata safety budget." />
      )}
      <JsonPanel value={detail.view.pipeline} empty="This view has an empty pipeline." />
    </div>
  )
}

function ShardingTab({ detail }: { detail: MongoCollectionDetail }) {
  if (!detail.sharding.available) {
    return (
      <EmptyDetail text="Sharding metadata is unavailable to this database account or deployment. Nuphos does not request elevated privileges to discover it." />
    )
  }
  if (!detail.sharding.sharded) return <EmptyDetail text="This collection is not sharded." />

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric label="Unique shard key" value={detail.sharding.unique ? 'Yes' : 'No'} />
        <Metric label="Balancing" value={detail.sharding.balancing ?? 'Unknown'} />
      </div>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-tertiary">Shard key</div>
      <JsonPanel value={detail.sharding.shardKey} empty="Shard key metadata is unavailable." />
    </div>
  )
}
