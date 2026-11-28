import { onboardingConnectorNames } from '../../../components/channels/onboardingConnectors'

import type { OnboardingConnectorName } from '../../../components/channels/onboardingConnectors'
import type { CloudLogo } from '../../../components/CloudLogo'
import type { ComponentProps } from 'react'

type Logo = ComponentProps<typeof CloudLogo>['provider']

/**
 * The tools the tour offers, as iOS does: connectors bound by signing in to the
 * provider, in the Connectors page's categories and order, personal first.
 */
export const TOOL_GROUPS = [
  {
    title: 'personal',
    tools: [
      { key: 'gmail', title: 'Gmail', logo: 'gmail' },
      { key: 'google-drive', title: 'Google Drive', logo: 'google-drive' },
      { key: 'google-calendar', title: 'Google Calendar', logo: 'google-calendar' },
    ],
  },
  {
    title: 'communication',
    tools: [
      { key: 'slack', title: 'Slack', logo: 'slack' },
      { key: 'discord', title: 'Discord', logo: 'discord' },
    ],
  },
  {
    title: 'projects',
    tools: [
      { key: 'linear', title: 'Linear', logo: 'linear' },
      { key: 'jira', title: 'Jira', logo: 'jira' },
      { key: 'asana', title: 'Asana', logo: 'asana' },
      { key: 'trello', title: 'Trello', logo: 'trello' },
    ],
  },
  { title: 'docs', tools: [{ key: 'plaud', title: 'Plaud', logo: 'plaud' }] },
  {
    title: 'code',
    tools: [
      { key: 'github', title: 'GitHub', logo: 'github' },
      { key: 'gitlab', title: 'GitLab', logo: 'gitlab' },
    ],
  },
  { title: 'cloud', tools: [{ key: 'cloudflare', title: 'Cloudflare', logo: 'cloudflare' }] },
  {
    title: 'monitoring',
    tools: [
      { key: 'sentry', title: 'Sentry', logo: 'sentry' },
      { key: 'posthog', title: 'PostHog', logo: 'posthog' },
    ],
  },
] as const satisfies readonly {
  title: string
  tools: readonly { key: string; title: string; logo: Logo }[]
}[]

export type TourTool = (typeof TOOL_GROUPS)[number]['tools'][number]['key']

const ALL_TOOLS: readonly { key: TourTool; title: string }[] = TOOL_GROUPS.flatMap(
  (group): readonly { key: TourTool; title: string }[] => group.tools,
)

/** The picked tools' names, in the tour's order, for the Bot's greeting and instructions. */
export function toolTitles(picks: readonly TourTool[]): string[] {
  return ALL_TOOLS.filter((tool) => picks.includes(tool.key)).map((tool) => tool.title)
}

/** The picked tools the first chat can offer a Connect button for. */
export function connectableTools(picks: readonly TourTool[]): OnboardingConnectorName[] {
  const connectable: readonly string[] = onboardingConnectorNames

  return toolTitles(picks).filter((title): title is OnboardingConnectorName =>
    connectable.includes(title),
  )
}
