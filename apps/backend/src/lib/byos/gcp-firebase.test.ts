import { expect, test } from 'bun:test'

import { useByosGcp } from '@/lib/test/doubles/byos-gcp'

useByosGcp({
  impersonateSa: async () => ({ getAccessToken: async () => ({ token: 'private-test-token' }) }),
})

const { firebaseGet } = await import('./gcp-firebase')
const handle = {
  teamId: 'team',
  projectId: 'selected-project',
  serviceAccountEmail: 'selected@example.test',
}

test('project read stays in the bound project and strips upstream resource/config fields', async () => {
  const request = (async (url: URL, init: RequestInit) => {
    expect(url.href).toBe('https://firebase.googleapis.com/v1beta1/projects/selected-project')
    expect(init.redirect).toBe('error')
    expect(init.headers).toEqual({ Authorization: 'Bearer private-test-token' })

    return Response.json({
      projectId: 'selected-project',
      projectNumber: '123',
      state: 'ACTIVE',
      resources: { secret: 'omit' },
    })
  }) as typeof fetch

  expect(await firebaseGet(handle, 'project', undefined, request)).toEqual({
    projectId: 'selected-project',
    projectNumber: '123',
    state: 'ACTIVE',
  })
})

test('app listing is bounded, preserves pagination, and never exports API identifiers', async () => {
  const request = (async (url: URL) => {
    expect(url.pathname).toBe('/v1beta1/projects/selected-project:searchApps')
    expect(url.searchParams.get('pageSize')).toBe('100')
    expect(url.searchParams.get('pageToken')).toBe('next /&?')

    return Response.json({
      apps: [{ appId: 'app', platform: 'WEB', apiKeyId: 'hidden' }],
      nextPageToken: 'another',
    })
  }) as typeof fetch

  expect(await firebaseGet(handle, 'apps', 'next /&?', request)).toEqual({
    apps: [{ appId: 'app', platform: 'WEB' }],
    nextPageToken: 'another',
  })
})

test('403 is terminal and never retried or converted to an empty inventory', async () => {
  let calls = 0
  const request = (async () => {
    calls++

    return Response.json({ error: { message: 'sensitive upstream body' } }, { status: 403 })
  }) as unknown as typeof fetch

  try {
    await firebaseGet(handle, 'project', undefined, request)
    throw new Error('expected permission failure')
  } catch (error) {
    expect(error).toMatchObject({ status: 403, code: 'firebase_upstream_error' })
    expect(String(error)).not.toContain('sensitive upstream body')
  }
  expect(calls).toBe(1)
})

test('disabled Management API and a missing Firebase project remain distinct failures', async () => {
  const disabled = (async () =>
    Response.json(
      { error: { details: [{ reason: 'SERVICE_DISABLED' }] } },
      { status: 403 },
    )) as unknown as typeof fetch
  const missing = (async () => Response.json({}, { status: 404 })) as unknown as typeof fetch

  await expect(firebaseGet(handle, 'project', undefined, disabled)).rejects.toMatchObject({
    code: 'firebase_api_disabled',
  })
  await expect(firebaseGet(handle, 'project', undefined, missing)).rejects.toMatchObject({
    code: 'firebase_upstream_error',
  })
})
