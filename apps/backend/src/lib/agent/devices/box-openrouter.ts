// A new account's free Box comes with OpenCode ready to chat: on a deployment with an
// OpenRouter management key, the Box gets an OpenRouter key of its own, capped at GIFT_USD,
// and its OpenCode uses it with a DeepSeek model by default. The key lives as long as the
// Box: it is made once the machine is ordered, and revoked when the Box is discarded or deleted.

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { QUICK_TIMEOUT_MS } from './box-instabox-client'
import { agentDevices } from './store'

import type { Sandbox } from '@insforge/instabox-sdk'

/** What the key may spend, in US dollars, ever: OpenRouter refuses requests past it. */
export const GIFT_USD = 1
/** OpenCode's model on the gifted key, for titles too, so all of it goes to one cheap model. */
export const GIFT_MODEL = 'openrouter/deepseek/deepseek-v4.1-flash'

const KEYS_URL = 'https://openrouter.ai/api/v1/keys'
const TIMEOUT_MS = 10_000

function managementKey(): string | undefined {
  return config.box.openRouterManagementKey
}

/** A new OpenRouter key for `teamId`, or undefined when the deployment gives none. Throws when OpenRouter refuses. */
export async function giftOpenRouterKey(
  teamId: string,
): Promise<{ key: string; hash: string } | undefined> {
  const management = managementKey()

  if (!management) return undefined
  const response = await fetch(KEYS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${management}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Nuphos team ${teamId}`, limit: GIFT_USD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`OpenRouter refused the key with ${String(response.status)}`)
  const { key, data } = (await response.json()) as { key?: unknown; data?: { hash?: unknown } }

  if (typeof key !== 'string' || !key || typeof data?.hash !== 'string' || !data.hash)
    throw new Error('OpenRouter returned no key')

  return { key, hash: data.hash }
}

/** Revokes a gifted key. Never throws: a key OpenRouter keeps is logged with its hash. */
export async function revokeOpenRouterKey(hash: string): Promise<void> {
  try {
    const management = managementKey()

    if (!management) throw new Error('No OpenRouter management key to revoke it with')
    const response = await fetch(`${KEYS_URL}/${encodeURIComponent(hash)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${management}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    // Already gone is revoked.
    if (!response.ok && response.status !== 404)
      throw new Error(`OpenRouter refused the revoke with ${String(response.status)}`)
  } catch (error) {
    logError('agent.box.openrouter_revoke_failed', error, { openrouter_key_hash: hash })
  }
}

/**
 * Gives the Box `deviceId` its key: recorded on the Box first, so deleting the Box revokes it,
 * then written to its OpenCode. Returns the key's hash, or undefined when there is none. A key
 * OpenRouter refuses, or a config that cannot be written, leaves a Box that still works; a Box
 * deleted meanwhile throws, after revoking the key.
 */
export async function giveBoxOpenRouterKey(
  userId: string,
  deviceId: string,
  teamId: string,
  sandbox: Sandbox,
): Promise<string | undefined> {
  const gift = await giftOpenRouterKey(teamId).catch((error: unknown) => {
    logError('agent.box.openrouter_gift_failed', error, { user_id: userId, team_id: teamId })

    return undefined
  })

  if (!gift) return undefined
  const { matchedCount } = await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    { $set: { 'box.openRouterKeyHash': gift.hash } },
  )

  if (!matchedCount) {
    await revokeOpenRouterKey(gift.hash)
    throw new AppError(409, 'box_gone', 'The computer was deleted while it was being created')
  }
  await sandbox.commands
    .run(OPENCODE_CONFIG_COMMAND, {
      envs: { NUPHOS_USER_ID: userId, OPENCODE_CONFIG: openCodeConfig(gift.key) },
      timeoutMs: QUICK_TIMEOUT_MS,
    })
    .catch((error: unknown) => {
      logError('agent.box.openrouter_config_failed', error, {
        user_id: userId,
        device_id: deviceId,
      })
    })

  return gift.hash
}

/** OpenCode's config on the gifted key. */
export function openCodeConfig(key: string): string {
  return JSON.stringify({
    model: GIFT_MODEL,
    small_model: GIFT_MODEL,
    provider: { openrouter: { options: { apiKey: key } } },
  })
}

/**
 * Writes OPENCODE_CONFIG as OpenCode's config in the OpenCode home the Box's runtime gives
 * NUPHOS_USER_ID (`nuphos agent`'s data dir, then users/<id>/opencode-home), which every
 * conversation's home shares. It replaces the whole file: on a Box just installed there is
 * none yet. The key comes in the environment, never on the command line.
 */
export const OPENCODE_CONFIG_COMMAND = [
  'set -e',
  'umask 077',
  'dir="$HOME/.local/share/nuphos/agent/users/$NUPHOS_USER_ID/opencode-home/.config/opencode"',
  'mkdir -p "$dir"',
  `printf '%s\\n' "$OPENCODE_CONFIG" > "$dir/opencode.json"`,
].join('\n')
