import { File, FileQuestion, Folder, FolderOpen, RefreshCw, Server } from 'lucide-react'
import { createPortal } from 'react-dom'

import { PageMeta } from '../app/pageMeta'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { Breadcrumb } from '../components/toolbar-breadcrumb'
import { Button } from '../components/ui/button'
import { useToolbarSlot } from '../hooks/useToolbarControls'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useRuntimeFiles } from '../hooks/useRuntimeFiles'

export function RuntimeFilesView({ teamId }: { teamId: string }) {
  const { conversationId, refreshKey, isActive } = useWorkspaceTab()
  const { source, path, directory, preview, fileName, loading, navigate, openFile, refresh } =
    useRuntimeFiles(teamId, conversationId, isActive, refreshKey)
  const navigationSlot = useToolbarSlot('left', isActive && Boolean(source))
  const runtimeSlot = useToolbarSlot('right', isActive)

  const entries = directory?.entries ?? []
  const folders = path.split('/').filter(Boolean)
  const breadcrumbs = folders.map((name, index) => ({
    label: index === 0 ? 'Workspace' : name,
    icon: index === 0 ? <FolderOpen className="h-3.5 w-3.5" /> : undefined,
    onClick:
      index < folders.length - 1 || fileName
        ? () => navigate(`/${folders.slice(0, index + 1).join('/')}`)
        : undefined,
  }))

  return (
    <PageMeta pageKey="team.files" title="Files" icon={<FolderOpen className="h-3.5 w-3.5" />}>
      {navigationSlot &&
        createPortal(
          <div className="flex min-w-0 items-center gap-1">
            <Breadcrumb
              expand
              segments={
                fileName
                  ? [
                      ...breadcrumbs,
                      {
                        label: fileName,
                        icon: <File className="h-3.5 w-3.5" />,
                        onClick: undefined,
                      },
                    ]
                  : breadcrumbs
              }
            />
          </div>,
          navigationSlot,
        )}
      {runtimeSlot &&
        createPortal(
          <div className="flex min-w-0 items-center gap-2">
            {source && (
              <span
                className="flex min-w-0 items-center gap-1.5 text-[11px] text-tertiary"
                title={source.label}
              >
                <Server className="h-3 w-3 shrink-0" strokeWidth={1.6} />
                <span className="truncate">{source.label}</span>
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh files"
              title="Refresh files"
              onClick={refresh}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>,
          runtimeSlot,
        )}
      {!source ? (
        <EmptyState
          icon={FolderOpen}
          title={conversationId && loading ? 'Opening workspace…' : 'Runtime files'}
          description={
            conversationId
              ? loading
                ? undefined
                : 'Select a runtime for this conversation, then refresh Files.'
              : 'Select a conversation to browse its workspace.'
          }
        />
      ) : fileName ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
          {loading ? (
            <div
              className="flex flex-1 items-center justify-center gap-2 text-[12px] text-tertiary"
              role="status"
            >
              Opening {fileName}…
            </div>
          ) : preview ? (
            'image' in preview ? (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-zGray-900/30 p-6">
                <img
                  src={preview.image}
                  alt={fileName}
                  className="max-h-full max-w-full rounded object-contain"
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
                <pre className="min-h-full p-4 font-mono text-[12px] leading-6 text-secondary">
                  <code>{preview.text}</code>
                </pre>
              </div>
            )
          ) : (
            <EmptyState
              icon={FileQuestion}
              title="Preview unavailable"
              description="This file could not be previewed."
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <Table
            columns={[
              {
                key: 'name',
                header: 'Name',
                grow: 1,
                minWidth: 140,
                primaryAction: true,
                onActivate: (entry) =>
                  entry.kind === 'directory'
                    ? navigate(`${path}/${entry.name}`)
                    : openFile(entry.name),
                render: (entry) => (
                  <span className="flex min-w-0 items-center gap-2">
                    {entry.kind === 'directory' ? (
                      <Folder
                        className="h-3.5 w-3.5 shrink-0 text-zViolet-accent"
                        strokeWidth={1.6}
                      />
                    ) : (
                      <File className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={1.6} />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </span>
                ),
              },
            ]}
            rows={entries}
            rowKey={(entry) => entry.name}
            loading={loading}
            empty={!directory ? 'No files loaded' : 'This folder is empty'}
            storageKey="runtime-files"
          />
          {directory && (
            <div className="flex shrink-0 items-center justify-between border-t border-main px-3 py-2 text-[11px] text-tertiary">
              <span>
                {directory.truncated
                  ? 'First 500 items'
                  : `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
              </span>
              <span>Read-only</span>
            </div>
          )}
        </div>
      )}
    </PageMeta>
  )
}
