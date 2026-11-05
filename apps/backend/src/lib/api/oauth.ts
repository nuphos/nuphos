import { z } from 'zod'

import type { ApiOperation } from './registry'

const tokenExchangeRequestSchema = z.object({
  grant_type: z.literal('urn:ietf:params:oauth:grant-type:token-exchange'),
  subject_token: z.string().describe('The conversation token (`NUPHOS_TOKEN`) to narrow.'),
  subject_token_type: z
    .enum(['urn:ietf:params:oauth:token-type:jwt', 'urn:ietf:params:oauth:token-type:access_token'])
    .describe('The subject token is a JWT.'),
  resource: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Repeatable. `credential:<provider>/<id>`, as `list_credentials` names it. The new token ' +
        'vends only these, each of which the subject token must be able to vend. Omit it to keep ' +
        "the subject's credentials.",
    ),
  audience: z.literal('nuphos-preview-mcp').optional(),
  team_id: z.string().optional().describe("Must match the subject token's team when given."),
  expires_in: z
    .string()
    .regex(/^\d+$/u)
    .optional()
    .describe(
      'Requested lifetime in seconds, 60–1800, and never past the subject token. Defaults to the ' +
        'shorter of 1800 and what remains of the subject.',
    ),
  actor: z
    .string()
    .optional()
    .describe(
      'Who the token is delegated to, recorded as the `act` claim: `desktop:<id>`, `cli:<id>`, ' +
        '`session:<id>` or `runtime:<id>`. Defaults to the subject conversation. It is an ' +
        'audit label the caller supplies, not an authenticated identity.',
    ),
})

const tokenExchangeResponseSchema = z.object({
  access_token: z.string(),
  issued_token_type: z.literal('urn:ietf:params:oauth:token-type:jwt'),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().describe('Lifetime of the issued token in seconds.'),
})

export const oauthApiOperations = [
  {
    operationId: 'oauth.tokenExchange',
    method: 'post',
    path: '/oauth/token',
    tags: ['OAuth'],
    summary: 'Exchange a conversation token for a narrower one (RFC 8693)',
    description:
      'Form-encoded (`application/x-www-form-urlencoded`). Turns a conversation token into one ' +
      'that is never broader: same conversation and team, a subset of the credentials the subject ' +
      'may vend, at most 30 minutes, and no later than the subject expires. No refresh token is ' +
      'issued. A request that would widen credentials, team or lifetime fails with ' +
      '`invalid_target` or `invalid_request`. Rate limited per subject token and per team; 429 ' +
      'means retry later (only when the backend has Redis). A token issued with `resource` vends ' +
      'only those credentials and is refused by the native tools, plans and file transfers. The same endpoint also serves the `authorization_code` and ' +
      '`refresh_token` grants of the MCP OAuth flow.',
    auth: 'none',
    requestContentType: 'application/x-www-form-urlencoded',
    requestSchema: tokenExchangeRequestSchema,
    responseSchema: tokenExchangeResponseSchema,
  },
] as const satisfies readonly ApiOperation[]
