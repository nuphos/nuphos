import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { webhooksQuery } from '../../lib/query/webhooks'

import { AdminOnlyHint, LoadFailed, SectionHeader } from './shared'
import { WebhookCard } from './WebhookCard'
import { WebhookEditorDialog } from './WebhookEditorDialog'

import type { WebhookEditorTarget } from './WebhookEditorDialog'
import type { AtlasTeam } from '../../types'
import type { TeamWebhook, WebhookInput } from '../../types/webhooks'

const MAX_WEBHOOKS = 20

export function WebhooksSection({ team }: { team: AtlasTeam | undefined }) {
  const teamId = team?.id ?? ''
  const isAdmin = team?.role === 'ADMINISTRATOR'
  const listing = useQuery({ ...webhooksQuery(teamId), enabled: Boolean(teamId) && isAdmin })
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<WebhookEditorTarget>(null)
  const [deleting, setDeleting] = useState<TeamWebhook | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.webhooks(teamId) })

  async function run(hook: TeamWebhook, title: string, action: () => Promise<unknown>) {
    setBusyId(hook.id)
    try {
      await action()
    } catch (err) {
      toast.apiError(title, err)
    } finally {
      setBusyId(null)
      void refresh()
    }
  }

  const toggle = (hook: TeamWebhook, enabled: boolean) =>
    run(hook, t('Couldn’t update the webhook'), () =>
      api.atlasUpdateWebhook(teamId, hook.id, { enabled }),
    )

  const test = (hook: TeamWebhook) =>
    run(hook, t('Couldn’t send the test event'), async () => {
      const result = await api.atlasTestWebhook(teamId, hook.id)

      if (result.ok) toast.success(t('Test event delivered'), `HTTP ${String(result.status)}`)
      else toast.error(t('The endpoint did not accept the test event'), result.error ?? undefined)
    })

  const remove = (hook: TeamWebhook) =>
    run(hook, t('Couldn’t delete the webhook'), async () => {
      await api.atlasDeleteWebhook(teamId, hook.id)
      toast.success(t('Webhook deleted'))
    })

  async function submit(input: WebhookInput) {
    if (editor === 'new') await api.atlasCreateWebhook(teamId, input)
    else if (editor) await api.atlasUpdateWebhook(teamId, editor.id, input)
    toast.success(t('Webhook saved'))
    void refresh()
  }

  const hooks = listing.data?.webhooks ?? []

  return (
    <div>
      <SectionHeader
        title={t('Webhooks')}
        description={t(
          'A conversation started by nuphos_ask with a webhook_id sends that webhook a POST request when it finishes a reply, fails, needs input, or it or one of its Tasks reports back, so your own systems can follow up without polling.',
        )}
      />
      {team && !isAdmin && <AdminOnlyHint teamId={team.id} />}
      {isAdmin && listing.isPending && (
        <div aria-busy="true" className="h-16 animate-pulse rounded-xl bg-state-selected" />
      )}
      {isAdmin && listing.isError && !listing.data && (
        <LoadFailed message={t('Couldn’t load webhooks.')} onRetry={() => void listing.refetch()} />
      )}
      {listing.data && (
        <section>
          <div className="mb-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={hooks.length >= MAX_WEBHOOKS}
              onClick={() => setEditor('new')}
            >
              + {t('Add webhook')}
            </Button>
          </div>
          {hooks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-control p-6 text-sm text-tertiary">
              {t('No webhooks yet.')}
            </p>
          ) : (
            <div className="space-y-3">
              {hooks.map((hook) => (
                <WebhookCard
                  key={hook.id}
                  hook={hook}
                  busy={busyId === hook.id}
                  onToggle={(enabled) => void toggle(hook, enabled)}
                  onTest={() => void test(hook)}
                  onEdit={() => setEditor(hook)}
                  onDelete={() => setDeleting(hook)}
                />
              ))}
            </div>
          )}
          <WebhookEditorDialog
            target={editor}
            events={listing.data.events}
            onClose={() => setEditor(null)}
            onSubmit={submit}
          />
        </section>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('Delete webhook')}
        description={t('Delete “{title}”? Nuphos stops sending events to it.', {
          title: deleting?.name ?? '',
        })}
        confirmLabel={t('Delete')}
        destructive
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
