import { describe, expect, test } from 'bun:test'

import { canonicalQuery, huaweiAuthorization, signHuaweiRequest } from './huawei-signer'
import { QUERY_CASE, SDK_VECTORS, TOKEN_CASE } from './huawei-signer-vectors'

describe('huawei signer', () => {
  test.each(SDK_VECTORS)('reproduces the official SDK vector: $name', (vector) => {
    expect(
      huaweiAuthorization(
        {
          method: vector.method,
          url: new URL(vector.url),
          headers: vector.headers,
          payload: Buffer.from(vector.body),
        },
        { accessKeyId: vector.ak, secretAccessKey: vector.sk },
      ),
    ).toBe(vector.expected)
  })

  test('builds the canonical query string of the SDK test', () => {
    const params = new URLSearchParams()

    for (const [k, v] of QUERY_CASE.params) params.append(k, v)

    expect(canonicalQuery(params)).toBe(QUERY_CASE.expected)
  })

  test('signs the security token of temporary credentials', () => {
    const headers = signHuaweiRequest(
      TOKEN_CASE.method,
      new URL(TOKEN_CASE.url),
      {
        accessKeyId: TOKEN_CASE.ak,
        secretAccessKey: TOKEN_CASE.sk,
        securityToken: TOKEN_CASE.token,
      },
      undefined,
      new Date(TOKEN_CASE.isoDate),
    )

    expect(headers['X-Sdk-Date']).toBe(TOKEN_CASE.date)
    expect(headers['X-Security-Token']).toBe(TOKEN_CASE.token)
    expect(headers.Authorization).toStartWith(
      'SDK-HMAC-SHA256 Access=TEMPAK, SignedHeaders=host;x-sdk-date;x-security-token, Signature=',
    )
  })
})
