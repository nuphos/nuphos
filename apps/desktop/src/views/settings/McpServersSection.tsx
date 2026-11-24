import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { mcpServersQuery } from '../../lib/query/mcp-servers'

import { McpServerCard } from './McpServerCard'
import { McpServerEditorDialog } from './McpServerEditorDialog'
import { AdminOnlyHint, LoadFailed, SectionHeader } from './shared'

import type { McpServerEditorTarget } from './McpServerEditorDialog'
import type { AtlasTeam } from '../../types'
import type { McpServerInput, TeamMcpServer } from '../../types/mcp-servers'

const MAX_MCP_SERVERS = 20

function McpServersList({
  servers,
  busyId,
  onAdd,
  onEdit,
  onDelete,
}: {
  servers: TeamMcpServer[]
  busyId: string | null
  onAdd: () => void
  onEdit: (server: TeamMcpServer) => void
  onDelete: (server: TeamMcpServer) => void
}) {
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={servers.length >= MAX_MCP_SERVERS}
          onClick={onAdd}
        >
          + {t('Add MCP server')}
        </Button>
      </div>
      {servers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-control p-6 text-sm text-tertiary">
          {t('No MCP servers yet.')}
        </p>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              busy={busyId === server.id}
              onEdit={() => onEdit(server)}
              onDelete={() => onDelete(server)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function DeleteMcpServerDialog({
  deleting,
  onClose,
  onConfirm,
}: {
  deleting: TeamMcpServer | null
  onClose: () => void
  onConfirm: (server: TeamMcpServer) => void
}) {
  return (
    <ConfirmDialog
      open={deleting !== null}
      title={t('Delete MCP server?')}
      description={
        deleting
          ? t('“{name}” will no longer be available to conversations in this team.', {
              name: deleting.name,
            })
          : ''
      }
      confirmLabel={t('Delete')}
      destructive
      onClose={onClose}
      onConfirm={() => {
        const target = deleting

        onClose()
        if (target) onConfirm(target)
      }}
    />
  )
}

export function McpServersSection({ team }: { team: AtlasTeam | undefined }) {
  const teamId = team?.id ?? ''
  const isAdmin = team?.role === 'ADMINISTRATOR'
  const listing = useQuery({ ...mcpServersQuery(teamId), enabled: Boolean(teamId) && isAdmin })
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<McpServerEditorTarget>(null)
  const [deleting, setDeleting] = useState<TeamMcpServer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers(teamId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.credentialOptions(teamId) })
  }

  async function remove(server: TeamMcpServer) {
    setBusyId(server.id)
    try {
      await api.atlasDeleteMcpServer(teamId, server.id)
      toast.success(t('MCP server deleted'))
    } catch (err) {
      toast.apiError(t('Couldn’t delete the MCP server'), err)
    } finally {
      setBusyId(null)
      refresh()
    }
  }

  async function submit(input: McpServerInput) {
    if (editor === 'new') await api.atlasCreateMcpServer(teamId, input)
    else if (editor) await api.atlasUpdateMcpServer(teamId, editor.id, input)
    toast.success(t('MCP server saved'))
    refresh()
  }

  const servers = listing.data ?? []

  return (
    <div>
      <SectionHeader
        title={t('MCP servers')}
        description={t(
          'Register remote HTTP MCP servers for your team. Header values are stored encrypted and never shown again.',
        )}
      />
      {team && !isAdmin && <AdminOnlyHint teamId={team.id} />}
      {isAdmin && listing.isPending && (
        <div aria-busy="true" className="h-16 animate-pulse rounded-xl bg-state-selected" />
      )}
      {isAdmin && listing.isError && !listing.data && (
        <LoadFailed
          message={t('Couldn’t load MCP servers.')}
          onRetry={() => void listing.refetch()}
        />
      )}
      {isAdmin && listing.data && (
        <section>
          <McpServersList
            servers={servers}
            busyId={busyId}
            onAdd={() => setEditor('new')}
            onEdit={setEditor}
            onDelete={setDeleting}
          />
          <McpServerEditorDialog
            target={editor}
            onClose={() => setEditor(null)}
            onSubmit={submit}
          />
          <DeleteMcpServerDialog
            deleting={deleting}
            onClose={() => setDeleting(null)}
            onConfirm={(target) => void remove(target)}
          />
        </section>
      )}
    </div>
  )
}
