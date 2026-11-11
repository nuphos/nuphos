import { api } from '../../api'
import { t } from '../../i18n/index.ts'

export async function loadTrelloInfo(teamId: string, connectorId: string) {
  const item = (await api.atlasListTrelloIntegrations(teamId)).find((i) => i.id === connectorId)

  if (!item) return null

  return {
    name: item.label,
    fields: [
      { label: t('Account'), value: item.username },
      { label: t('Authorization'), value: 'Composio-managed OAuth1' },
    ],
    externalUrl: 'https://trello.com',
    externalLabel: t('Open {name}', { name: 'Trello' }),
  }
}
