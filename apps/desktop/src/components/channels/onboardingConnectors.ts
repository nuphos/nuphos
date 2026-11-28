/** The connectors a new Bot's owner picked during onboarding, kept for its first chat. */
export const onboardingConnectorNames = [
  'Linear',
  'Jira',
  'Asana',
  'Trello',
  'Plaud',
  'GitHub',
  'Sentry',
] as const

export type OnboardingConnectorName = (typeof onboardingConnectorNames)[number]

const storageKey = (channelId: string) => `nuphos.onboardingConnectors.${channelId}`

function known(name: unknown): name is OnboardingConnectorName {
  return onboardingConnectorNames.includes(name as OnboardingConnectorName)
}

export function rememberOnboardingConnectors(channelId: string, names: readonly string[]) {
  const picked = names.filter(known)

  if (picked.length) localStorage.setItem(storageKey(channelId), JSON.stringify(picked))
  else localStorage.removeItem(storageKey(channelId))
}

export function readOnboardingConnectors(channelId: string): OnboardingConnectorName[] {
  try {
    const names: unknown = JSON.parse(localStorage.getItem(storageKey(channelId)) ?? '[]')

    return Array.isArray(names) ? names.filter(known) : []
  } catch {
    return []
  }
}
