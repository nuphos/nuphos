import { config } from '@/config'

import { exchangeGithubCode, getGithubUser, githubAuthorizeUrl, githubOAuthClient } from './github'
import {
  exchangeGoogleCode,
  getGoogleUser,
  googleAuthorizeUrl,
  isGoogleProvider,
  teamGoogleClient,
} from './google'

import type { PersonalCredentialProvider } from '@/models'

type AuthorizeArgs = { clientId: string; redirectUri: string; state: string; codeChallenge: string }

/**
 * GitHub and Google connect with PKCE; Linear does not. Google uses the OAuth
 * client of the team the member connects through.
 */
export async function pkceFlow(provider: PersonalCredentialProvider, teamId: string | undefined) {
  if (provider === 'github') {
    return {
      client: githubOAuthClient(),
      key: config.byos.github.encryptionKey,
      authorizeUrl: githubAuthorizeUrl,
      exchange: exchangeGithubCode,
      user: getGithubUser,
    }
  }

  return isGoogleProvider(provider)
    ? {
        client: teamId ? await teamGoogleClient(teamId) : null,
        key: config.byos.linear.encryptionKey,
        authorizeUrl: (args: AuthorizeArgs) => googleAuthorizeUrl({ ...args, provider }),
        exchange: exchangeGoogleCode,
        user: getGoogleUser,
      }
    : null
}
