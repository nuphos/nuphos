// A new account's free Box comes with OpenCode ready to chat: on a deployment with an
// OpenRouter management key, its first team gets an OpenRouter key of its own, capped at
// GIFT_USD, and the Box's OpenCode uses it with a DeepSeek model by default.

import { config } from '@/config'

/** What the key may spend, in US dollars, ever: OpenRouter refuses requests past it. */
export const GIFT_USD = 1
/** OpenCode's model on the gifted key, for titles too, so all of it goes to one cheap model. */
export const GIFT_MODEL = 'openrouter/deepseek/deepseek-v4.1-flash'

const KEYS_URL = 'https://openrouter.ai/api/v1/keys'

/** A new OpenRouter key for `teamId`, or undefined when the deployment gives none. Throws when OpenRouter refuses. */
export async function giftOpenRouterKey(teamId: string): Promise<string | undefined> {
  const management = config.box.openRouterManagementKey

  if (!management) return undefined
  const response = await fetch(KEYS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${management}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Nuphos team ${teamId}`, limit: GIFT_USD }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) throw new Error(`OpenRouter refused the key with ${String(response.status)}`)
  const { key } = (await response.json()) as { key?: unknown }

  if (typeof key !== 'string' || !key) throw new Error('OpenRouter returned no key')

  return key
}

/**
 * Writes OpenCode's config in the OpenCode home the Box's runtime gives NUPHOS_USER_ID
 * (`nuphos agent`'s data dir, then users/<id>/opencode-home), which every conversation's
 * home shares. The key comes in OPENROUTER_API_KEY, never on the command line.
 */
export const OPENCODE_OPENROUTER_COMMAND = [
  'set -e',
  'umask 077',
  'dir="$HOME/.local/share/nuphos/agent/users/$NUPHOS_USER_ID/opencode-home/.config/opencode"',
  'mkdir -p "$dir"',
  `printf '{"model":"${GIFT_MODEL}","small_model":"${GIFT_MODEL}","provider":{"openrouter":{"options":{"apiKey":"%s"}}}}\\n' "$OPENROUTER_API_KEY" > "$dir/opencode.json"`,
].join('\n')
