import { t } from '../../i18n'
import { Button } from '../ui/button'
import type { RuntimeInstance } from '../../types/runtime'

export function BotImportGuide({
  busy,
  selectedId,
  runtimeInstances,
  server,
  destination,
  onSave,
  onChoose,
  onRuntimeChange,
}: {
  busy: boolean
  selectedId?: string
  runtimeInstances: RuntimeInstance[]
  server: string
  destination: string
  onSave: () => void
  onChoose: () => void
  onRuntimeChange: (id: string) => void
}) {
  return (
    <>
      <section className="space-y-2">
        <h3 className="font-medium">{t('1. Prepare an export in Grok Bot')}</h3>
        <p className="text-secondary">
          {t(
            'Save this skill, add it to a temporary helper in Grok Bot, then ask it to prepare a Nuphos Bot bundle. Choose which Bots, chats and files to include. You will reconnect accounts in Nuphos.',
          )}
        </p>
        <Button variant="secondary" disabled={busy} onClick={onSave}>
          {t('Save export skill')}
        </Button>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">{t('2. Choose the destination')}</h3>
        <select
          className="w-full rounded-lg border border-line-control bg-main p-2"
          value={selectedId ?? ''}
          onChange={(event) => onRuntimeChange(event.target.value)}
          disabled={busy}
          aria-label={t('Destination agent')}
        >
          {!selectedId && <option value="">{t('Choose an agent')}</option>}
          {runtimeInstances
            .filter((runtime) => runtime.status === 'active')
            .map((runtime) => (
              <option key={runtime.id} value={runtime.id}>
                {runtime.label}
              </option>
            ))}
        </select>
        <p className="text-secondary">
          {t('The ZIP will be uploaded to your signed-in Nuphos server')} <strong>{server}</strong>.{' '}
          {t('Imported Bots will use')} <strong>{destination}</strong>.
        </p>
        <p className="text-xs text-tertiary">
          {t(
            'The preview expires after 30 minutes. Existing sign-ins, connector access and full chat history are not transferred.',
          )}
        </p>
      </section>
      <Button disabled={busy || !selectedId} onClick={onChoose}>
        {busy ? t('Reading export…') : t('Choose ZIP and preview')}
      </Button>
    </>
  )
}
