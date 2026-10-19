import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { createDefaultAccess } from '@/lib/byos/access'
import {
  exchangePlaudCode,
  fetchPlaudUser,
  invalidatePlaudAccessToken,
  PlaudApiError,
} from '@/lib/byos/plaud'
import { decryptPlaudSecret, encryptPlaudSecret } from '@/lib/byos/secrets'
import { finishConnectorOAuth } from '@/lib/connector-oauth'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { emptyTeamByosBindings, plaudPendingOAuth, teamByosBindings } from '@/models'

import type { PlaudAccountBinding } from '@/models'
import type { Context } from 'hono'

export const plaudAppRoutes = new Hono()

const DESKTOP_CALLBACK = 'nuphos://plaud-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

plaudAppRoutes.get('/callback', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) throw new AppError(400, 'invalid_state', 'Missing state from Plaud redirect')

  const pending = await plaudPendingOAuth().findOneAndDelete({ _id: state })

  if (errorParam) {
    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }
  if (!pending || pending.expiresAt.getTime() < Date.now()) {
    return desktopCallback(c, {
      state,
      error: pending ? 'expired' : 'unknown_state',
      error_description: 'The Plaud authorization expired or was already used. Try again.',
    })
  }
  if (!code) throw new AppError(400, 'invalid_code', 'Missing code from Plaud redirect')

  let draft: PlaudBindingDraft

  try {
    const tokens = await exchangePlaudCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      code,
      codeVerifier: decryptPlaudSecret(pending.encryptedCodeVerifier),
    })
    const user = await fetchPlaudUser(tokens.accessToken)

    draft = {
      plaudUserId: user.id,
      userName: user.name,
      userEmail: user.email,
      clientId: pending.clientId,
      encryptedAccessToken: encryptPlaudSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? encryptPlaudSecret(tokens.refreshToken) : null,
      accessTokenExpiresAt: tokens.expiresAt,
      requesterUserId: pending.requesterUserId,
    }
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'exchange_failed',
      error_description: e instanceof PlaudApiError ? e.message : 'Plaud authorization failed',
    })
  }

  return desktopCallback(
    c,
    await finishConnectorOAuth({
      provider: 'plaud',
      state,
      teamId: pending.teamId,
      requesterUserId: pending.requesterUserId,
      draft,
      persist: persistPlaudBinding,
    }),
  )
})

type PlaudBindingDraft = Omit<PlaudAccountBinding, 'id' | 'label' | 'createdAt' | 'access'> & {
  requesterUserId: string
}

// Reconnecting the same Plaud user replaces that binding's tokens and keeps
// its id, label and access list.
export async function persistPlaudBinding(
  teamId: ObjectId,
  { requesterUserId, ...draft }: PlaudBindingDraft,
): Promise<Record<string, string>> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { plaudAccounts: 1 } },
  )
  const existing = (doc?.plaudAccounts ?? []).find((b) => b.plaudUserId === draft.plaudUserId)
  const label = draft.userName ?? draft.userEmail ?? 'Plaud'
  const binding: PlaudAccountBinding = {
    ...draft,
    id: existing?.id ?? new ObjectId(),
    label: existing?.label ?? label,
    createdAt: existing?.createdAt ?? new Date(),
    access: existing?.access ?? createDefaultAccess(requesterUserId),
  }

  if (existing) {
    await teamByosBindings().updateOne(
      { _id: teamId },
      { $set: { 'plaudAccounts.$[el]': binding, updatedAt: new Date() } },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    invalidatePlaudAccessToken(teamId, existing.id)
  } else {
    const { plaudAccounts: _pushed, ...insertDefaults } = emptyTeamByosBindings()

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { plaudAccounts: binding },
        $set: { updatedAt: new Date() },
        $setOnInsert: insertDefaults,
      },
      { upsert: true },
    )
  }

  return {
    binding_id: binding.id.toHexString(),
    team_id: teamId.toHexString(),
    account_name: binding.label,
  }
}
