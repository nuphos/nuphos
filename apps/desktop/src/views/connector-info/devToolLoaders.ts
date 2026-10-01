import { api } from '../../api'
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
        { label: 'Label', value: item.label },
        { label: 'Workspace', value: item.workspaceName || '—' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://www.notion.so',
      externalLabel: 'Open Notion',
    }
  },
  upstash: async (teamId, connectorId) => {
    const item = (await api.atlasListUpstashAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        { label: 'Account email', value: item.email },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://console.upstash.com',
      externalLabel: 'Open Upstash Console',
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
        { label: 'Label', value: item.label },
        {
          label: 'Permission',
          value: item.permission === 'sending_access' ? 'Sending access' : 'Full access',
        },
        { label: 'Domains', value: item.domains?.length ? item.domains.join(', ') : '—' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://resend.com',
      externalLabel: 'Open Resend',
    }
  },
  linear: async (teamId, connectorId) => {
    const item = (await api.atlasListLinearWorkspaces(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.workspaceName,
      fields: [
        { label: 'Workspace', value: item.workspaceName },
        {
          label: 'URL',
          value: item.organizationUrlKey ? `linear.app/${item.organizationUrlKey}` : '—',
          mono: !!item.organizationUrlKey,
        },
        { label: 'Account', value: item.accountName || '—' },
        { label: 'OAuth scope', value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: item.organizationUrlKey ? `https://linear.app/${item.organizationUrlKey}` : null,
      externalLabel: 'Open Linear',
    }
  },
  jira: async (teamId, connectorId) => {
    const item = (await api.atlasListJiraSites(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.siteName,
      fields: [
        { label: 'Site', value: item.siteName },
        {
          label: 'URL',
          value: item.siteUrl ? item.siteUrl.replace(/^https?:\/\//, '') : '—',
          mono: !!item.siteUrl,
        },
        { label: 'Account', value: item.accountName || '—' },
        { label: 'Cloud ID', value: item.cloudId, mono: true },
        { label: 'OAuth scope', value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: item.siteUrl || null,
      externalLabel: 'Open Jira',
    }
  },
  asana: async (teamId, connectorId) => {
    const item = (await api.atlasListAsanaAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.accountName || item.accountGid,
      fields: [
        { label: 'Account', value: item.accountName || '—' },
        { label: 'Email', value: item.accountEmail || '—' },
        { label: 'Account GID', value: item.accountGid, mono: true },
        { label: 'OAuth scope', value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://app.asana.com',
      externalLabel: 'Open Asana',
    }
  },
  sentry: async (teamId, connectorId) => {
    const item = (await api.atlasListSentryAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label || item.userName || item.userId,
      fields: [
        { label: 'Account', value: item.userName || '—' },
        { label: 'Email', value: item.userEmail || '—' },
        { label: 'User ID', value: item.userId, mono: true },
        { label: 'OAuth scope', value: item.scope, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://sentry.io',
      externalLabel: 'Open Sentry',
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
        { label: 'Label', value: item.label },
        { label: 'Region', value: POSTHOG_REGION_LABELS[item.region] },
        { label: 'API host', value: item.apiBaseUrl, mono: true },
        { label: 'Account email', value: item.userEmail || '—' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: item.apiBaseUrl,
      externalLabel: 'Open PostHog',
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
        { label: 'Label', value: item.label },
        { label: 'Organization', value: item.orgDisplayName || '—' },
        {
          label: 'Auth',
          value: item.authType === 'oauth' ? 'OAuth' : 'Client credentials',
        },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://app.vanta.com',
      externalLabel: 'Open Vanta',
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
        { label: 'Label', value: item.label },
        { label: 'Region', value: item.region.toUpperCase() },
        { label: 'Auth', value: 'API key' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://app.secureframe.com',
      externalLabel: 'Open Secureframe',
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
        { label: 'Label', value: item.label },
        { label: 'URL', value: item.baseUrl.replace(/^https?:\/\//, ''), mono: true },
        { label: 'Version', value: item.version || '—' },
        { label: 'Auth', value: 'Encrypted user token' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: item.baseUrl,
      externalLabel: 'Open SonarQube',
    }
  },
}
