/** The panel is on screen unless its host says otherwise; a page defaults to shown. */
export function panelVisible(variant: 'page' | 'panel', open: boolean | undefined): boolean {
  return open ?? variant === 'page'
}

/** The home is what the user sees: an on-screen panel not showing a conversation. */
export function homeVisible(panelOnScreen: boolean, showingConversationPage: boolean): boolean {
  return panelOnScreen && !showingConversationPage
}
