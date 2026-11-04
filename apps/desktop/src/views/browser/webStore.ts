export const WEB_STORE_URL = 'https://chromewebstore.google.com/category/extensions'

/** The extension ID of a Chrome Web Store item page, or null for any other page. */
export function webStoreItemId(url: string): string | null {
  return (
    /^https:\/\/(?:chromewebstore\.google\.com\/detail|chrome\.google\.com\/webstore\/detail)\/(?:[^/?#]+\/)?([a-p]{32})(?:[/?#]|$)/.exec(
      url,
    )?.[1] ?? null
  )
}
