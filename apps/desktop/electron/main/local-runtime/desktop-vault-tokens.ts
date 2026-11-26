import { atlasErrorInfo } from '../../atlas/error.ts'
import { getItem } from '../../vault/vault.ts'

import { CLAUDE_TOKEN_ITEM } from './vault-token.ts'

import type { VaultToken } from './vault-token.ts'

const read = () => getItem(CLAUDE_TOKEN_ITEM)

/**
 * This app is a device of its owner's vault: a Claude Code token they shared with it is an
 * agent of its own. Not shared, or this device not in the vault, is none; anything else is
 * unknown, which keeps the agent.
 */
export const desktopVaultTokens =
  (owner: () => string | null) => async (): Promise<VaultToken[] | null> => {
    try {
      await read()
    } catch (error) {
      return ['not_found', 'vault_desktop'].includes(atlasErrorInfo(error).code ?? '') ? [] : null
    }

    return [{ owner: owner() ?? '', name: '', read }]
  }
