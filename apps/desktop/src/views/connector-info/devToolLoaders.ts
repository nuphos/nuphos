import { api } from '../../api'
import { t } from '../../i18n/index.ts'
import { POSTHOG_REGION_LABELS } from '../../types/posthog'

import type { ConnectorInfoLoaders } from './types'

export const devToolLoaders: ConnectorInfoLoaders = {
  notion: async (teamId, connectorId) => {
    const item = (await api.atlasListNotionIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Workspace'), value: item.workspaceName || '—' },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://www.notion.so',
      externalLabel: t('Open {name}', { name: 'Notion' }),
    }
  },
  upstash: async (teamId, connectorId) => {
    const item = (await api.atlasListUpstashAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Account email'), value: item.email },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://console.upstash.com',
      externalLabel: t('Open {name}', { name: 'Upstash Console' }),
    }
  },
  resend: async (teamId, connectorId) => {
    const item = (await api.atlasListResendIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        {
          label: t('Permission'),
          value: item.permission === 'sending_access' ? t('Sending access') : t('Full access'),
        },
        { label: t('Domains'), value: item.domains?.length ? item.domains.join(', ') : '—' },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://resend.com',
      externalLabel: t('Open {name}', { name: 'Resend' }),
    }
  },
  linear: async (teamId, connectorId) => {
    const item = (await api.atlasListLinearWorkspaces(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.workspaceName,
      fields: [
        { label: t('Workspace'), value: item.workspaceName },
        {
          label: 'URL',
          value: item.organizationUrlKey ? `linear.app/${item.organizationUrlKey}` : '—',
          mono: !!item.organizationUrlKey,
        },
        { label: t('Account'), value: item.accountName || '—' },
        { label: t('OAuth scope'), value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: item.organizationUrlKey ? `https://linear.app/${item.organizationUrlKey}` : null,
      externalLabel: t('Open {name}', { name: 'Linear' }),
    }
  },
  jira: async (teamId, connectorId) => {
    const item = (await api.atlasListJiraSites(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.siteName,
      fields: [
        { label: t('Site'), value: item.siteName },
        {
          label: 'URL',
          value: item.siteUrl ? item.siteUrl.replace(/^https?:\/\//, '') : '—',
          mono: !!item.siteUrl,
        },
        { label: t('Account'), value: item.accountName || '—' },
        { label: t('Cloud ID'), value: item.cloudId, mono: true },
        { label: t('OAuth scope'), value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: item.siteUrl || null,
      externalLabel: t('Open {name}', { name: 'Jira' }),
    }
  },
  asana: async (teamId, connectorId) => {
    const item = (await api.atlasListAsanaAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.accountName || item.accountGid,
      fields: [
        { label: t('Account'), value: item.accountName || '—' },
        { label: t('Email'), value: item.accountEmail || '—' },
        { label: t('Account GID'), value: item.accountGid, mono: true },
        { label: t('OAuth scope'), value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://app.asana.com',
      externalLabel: t('Open {name}', { name: 'Asana' }),
    }
  },
  sentry: async (teamId, connectorId) => {
    const item = (await api.atlasListSentryAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.userName || item.userId,
      fields: [
        { label: t('Account'), value: item.userName || '—' },
        { label: t('Email'), value: item.userEmail || '—' },
        { label: t('User ID'), value: item.userId, mono: true },
        { label: t('OAuth scope'), value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://sentry.io',
      externalLabel: t('Open {name}', { name: 'Sentry' }),
    }
  },
  posthog: async (teamId, connectorId) => {
    const item = (await api.atlasListPosthogIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Region'), value: POSTHOG_REGION_LABELS[item.region] },
        { label: t('API host'), value: item.apiBaseUrl, mono: true },
        { label: t('Account email'), value: item.userEmail || '—' },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: item.apiBaseUrl,
      externalLabel: t('Open {name}', { name: 'PostHog' }),
    }
  },
  plaud: async (teamId, connectorId) => {
    const item = (await api.atlasListPlaudAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Account'), value: item.userEmail || item.userName || '—' },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://web.plaud.ai',
      externalLabel: t('Open {name}', { name: 'Plaud' }),
    }
  },
  vanta: async (teamId, connectorId) => {
    const item = (await api.atlasListVantaIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.orgDisplayName || item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Organization'), value: item.orgDisplayName || '—' },
        { label: t('Auth'), value: t('Client credentials') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://app.vanta.com',
      externalLabel: t('Open {name}', { name: 'Vanta' }),
    }
  },
  secureframe: async (teamId, connectorId) => {
    const item = (await api.atlasListSecureframeIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Region'), value: item.region.toUpperCase() },
        { label: t('Auth'), value: t('API key') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://app.secureframe.com',
      externalLabel: t('Open {name}', { name: 'Secureframe' }),
    }
  },
  sonarqube: async (teamId, connectorId) => {
    const item = (await api.atlasListSonarqubeIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: 'URL', value: item.baseUrl.replace(/^https?:\/\//, ''), mono: true },
        { label: t('Version'), value: item.version || '—' },
        { label: t('Auth'), value: t('Encrypted user token') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: item.baseUrl,
      externalLabel: t('Open {name}', { name: 'SonarQube' }),
    }
  },
}
