import { useState } from 'react'

import { api } from '../../api'
import { locale, t } from '../../i18n'
import { BindAsanaDialog } from '../../views/BindAsanaDialog'
import { BindGithubDialog } from '../../views/BindGithubDialog'
import { BindJiraDialog } from '../../views/BindJiraDialog'
import { BindLinearDialog } from '../../views/BindLinearDialog'
import { BindPlaudDialog } from '../../views/BindPlaudDialog'
import { BindSentryDialog } from '../../views/BindSentryDialog'
import { BindTrelloDialog } from '../../views/BindTrelloDialog'
import { storedConversationCredentialAccess } from '../agent/panel/conversationCredentialAccess'
import { normalizeCredentialOptions } from '../agent/panel/credentialAccess'
import { toast } from '../ui/toast'

import { readOnboardingConnectors, rememberOnboardingConnectors } from './onboardingConnectors'

import type { OnboardingConnectorName } from './onboardingConnectors'
import type { AgentCredentialOptions } from '../../api'
import type { ComponentType } from 'react'

type BindDialog = ComponentType<{
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
}>

type Choice = { id: string; label: string }

type Field =
  | 'linearWorkspaceIds'
  | 'jiraSiteIds'
  | 'asanaAccountIds'
  | 'trelloIntegrationIds'
  | 'plaudAccountIds'
  | 'githubInstallationIds'
  | 'sentryAccountIds'

const connectors: Record<
  OnboardingConnectorName,
  {
    dialog: BindDialog
    field: Field
    choices: (options: AgentCredentialOptions) => Choice[]
  }
> = {
  Linear: {
    dialog: BindLinearDialog,
    field: 'linearWorkspaceIds',
    choices: (o) =>
      o.linearWorkspaces.map((i) => ({ id: i.workspaceId, label: i.workspaceName || i.label })),
  },
  Jira: {
    dialog: BindJiraDialog,
    field: 'jiraSiteIds',
    choices: (o) => o.jiraSites.map((i) => ({ id: i.siteId, label: i.label })),
  },
  Asana: {
    dialog: BindAsanaDialog,
    field: 'asanaAccountIds',
    choices: (o) => o.asanaAccounts.map((i) => ({ id: i.accountId, label: i.label })),
  },
  Trello: {
    dialog: BindTrelloDialog,
    field: 'trelloIntegrationIds',
    choices: (o) => o.trelloIntegrations.map((i) => ({ id: i.integrationId, label: i.label })),
  },
  Plaud: {
    dialog: BindPlaudDialog,
    field: 'plaudAccountIds',
    choices: (o) => o.plaudAccounts.map((i) => ({ id: i.bindingId, label: i.label })),
  },
  GitHub: {
    dialog: BindGithubDialog,
    field: 'githubInstallationIds',
    choices: (o) =>
      o.githubInstallations.map((i) => ({ id: i.installationId, label: i.accountLogin })),
  },
  Sentry: {
    dialog: BindSentryDialog,
    field: 'sentryAccountIds',
    choices: (o) => o.sentryAccounts.map((i) => ({ id: i.accountId, label: i.label })),
  },
}

function tryPrompt(name: OnboardingConnectorName) {
  if (locale === 'zh-TW') {
    return name === 'Linear'
      ? 'Linear 已連接。請列出我手上最多三筆待辦事項，用繁體中文摘要。'
      : `${name} 已連接。請示範一個唯讀的小任務，用繁體中文說明結果。`
  }
  const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale

  return name === 'Linear'
    ? `Linear is connected. Please list up to three of my open issues and reply in ${language}.`
    : `${name} is connected. Please show me one small read-only task I can try and reply in ${language}.`
}

function buttonLabel(name: OnboardingConnectorName, connecting: boolean, connected: boolean) {
  if (connecting) return t('Connecting…')

  return connected ? t('Try {name}', { name }) : t('Connect {name}', { name })
}

/**
 * The buttons under a new Bot's first chat: connect each tool its owner picked
 * during onboarding with the same flow as Connectors, give the Bot access, then
 * offer a first small task.
 */
export function OnboardingConnectorActions({
  teamId,
  channelId,
  bot,
  send,
}: {
  teamId: string
  channelId: string
  bot: string
  send: (text: string, filePaths: string[]) => unknown
}) {
  const [names, setNames] = useState(() => readOnboardingConnectors(channelId))
  const [connected, setConnected] = useState<OnboardingConnectorName[]>([])
  const [active, setActive] = useState<OnboardingConnectorName>()
  const [binding, setBinding] = useState<OnboardingConnectorName>()
  const [choosing, setChoosing] = useState<{ name: OnboardingConnectorName; choices: Choice[] }>()

  if (!names.length) return null

  async function choicesFor(name: OnboardingConnectorName) {
    return connectors[name].choices(
      normalizeCredentialOptions(await api.agentGetCredentialOptions(teamId)),
    )
  }

  async function connect(name: OnboardingConnectorName) {
    setActive(name)
    try {
      const choices = await choicesFor(name)

      if (choices.length === 0) setBinding(name)
      else if (choices.length === 1) await grant(name, choices[0].id)
      else setChoosing({ name, choices })
    } catch (err) {
      toast.apiError(t('Could not connect {name}', { name }), err)
    } finally {
      setActive(undefined)
    }
  }

  async function bound(name: OnboardingConnectorName) {
    setActive(name)
    try {
      const choices = await choicesFor(name)

      if (choices.length === 1) await grant(name, choices[0].id)
      else if (choices.length > 1) setChoosing({ name, choices })
    } catch (err) {
      toast.apiError(t('Could not connect {name}', { name }), err)
    } finally {
      setActive(undefined)
    }
  }

  async function grant(name: OnboardingConnectorName, id: string) {
    const [options, detail] = await Promise.all([
      api.agentGetCredentialOptions(teamId),
      api.agentGetConversation(bot, teamId, { tail: 1, runtimeState: 'omit' }),
    ])
    const current = storedConversationCredentialAccess(
      detail.credentialAccess ?? null,
      normalizeCredentialOptions(options),
    )
    const field = connectors[name].field

    if (!current[field].includes(id)) {
      await api.agentUpdateConversationCredentials({
        sessionId: bot,
        teamId,
        credentialAccess: { ...current, [field]: [...current[field], id] },
      })
    }
    setConnected((list) => [...list, name])
  }

  function tryConnector(name: OnboardingConnectorName) {
    const rest = names.filter((item) => item !== name)

    rememberOnboardingConnectors(channelId, rest)
    setNames(rest)
    send(tryPrompt(name), [])
  }

  const Dialog = binding ? connectors[binding].dialog : undefined

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {choosing
        ? choosing.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              disabled={Boolean(active)}
              className="rounded-full border border-main px-3 py-1 text-xs text-main transition-colors hover:bg-state-hover disabled:opacity-50"
              onClick={() => {
                const { name } = choosing

                setChoosing(undefined)
                setActive(name)
                grant(name, choice.id)
                  .catch((err: unknown) =>
                    toast.apiError(t('Could not connect {name}', { name }), err),
                  )
                  .finally(() => setActive(undefined))
              }}
            >
              {choosing.name} · {choice.label}
            </button>
          ))
        : names.map((name) => (
            <button
              key={name}
              type="button"
              disabled={Boolean(active ?? binding)}
              className="rounded-full border border-main px-3 py-1 text-xs text-main transition-colors hover:bg-state-hover disabled:opacity-50"
              onClick={() => (connected.includes(name) ? tryConnector(name) : void connect(name))}
            >
              {buttonLabel(name, active === name, connected.includes(name))}
            </button>
          ))}
      {Dialog && binding && (
        <Dialog
          open
          teamId={teamId}
          onClose={() => setBinding(undefined)}
          onBound={() => void bound(binding)}
        />
      )}
    </div>
  )
}
