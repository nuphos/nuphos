import { atlasErrorInfo } from '../../atlas/error.ts'
import { sharedItem, sharers } from '../../vault/computer.ts'

import { CLAUDE_TOKEN_ITEM } from './vault-token.ts'

import type { VaultToken } from './vault-token.ts'

/**
 * This app is a computer like any other: each Claude Code token shared with it, its owner's
 * or another person's, is an agent of its own. This device not in a vault is none; anything
 * else is unknown, which keeps the agents.
 */
export const desktopVaultTokens =
  (computer: () => string) => async (): Promise<VaultToken[] | null> => {
    try {
      const owners = await sharers(CLAUDE_TOKEN_ITEM, computer())

      return owners.map(({ userId, name }) => ({
        owner: userId,
        name,
        read: () => sharedItem(CLAUDE_TOKEN_ITEM, userId, computer()),
      }))
    } catch (error) {
      return ['not_found', 'vault_desktop'].includes(atlasErrorInfo(error).code ?? '') ? [] : null
    }
  }
