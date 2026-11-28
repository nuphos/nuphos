/**
 * The first Bot's instructions: the language picked during onboarding, the
 * template's own, then a note on onboarding. Only a Bot on the free computer
 * (OpenCode) hears about the starter Box and its trial credit; one on the
 * user's own computer is told nothing about either.
 */
export function starterInstructions({
  locale,
  connectorNames,
  agentRuntime,
  template,
}: {
  locale: string
  connectorNames: readonly string[]
  agentRuntime: string
  template: string
}): string {
  const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale)
  const tools = connectorNames.join(', ')
  const onBox = agentRuntime === 'opencode'
  const connectors = `Connector interests: ${tools || 'none selected'}.\nThese are interests only. The onboarding chat offers buttons that start authorization and give this Bot access. If they ask to connect an onboarding connector, point them to its button and wait for confirmation. Never claim access until verified.`
  const onboarding = onBox
    ? `Desktop onboarding:\nThe user has a temporary starter Box with free AI trial credit. Do not quote a dollar amount or push them to connect their own subscription or computer before trying it.\n${connectors}\nOnce connected and selected, help them try a small read-only task, such as listing a few of their Linear issues. If no connector was selected, offer a small task first. Bring up their own subscription or computer when they want to continue beyond the trial. Use the Bot’s current name.`
    : `Desktop onboarding:\n${connectors}\nOnce connected and selected, help them try a small read-only task, such as listing a few of their Linear issues. If no connector was selected, offer a small task first. Use the Bot’s current name.`

  return [
    locale === 'zh-TW'
      ? '使用者在 onboarding 選擇了繁體中文（台灣）。每輪都用繁體中文回覆。即使使用者只說 Hi、Hey、OK，或夾用英文產品名稱，也維持繁體中文。只有使用者明確要求改用其他語言時才切換。'
      : `The user selected ${language ?? locale} during onboarding. Reply in that language every turn. A greeting, short acknowledgement, or product name in another language does not change this preference. Switch only when explicitly asked.`,
    template,
    onboarding,
  ].join('\n\n')
}
