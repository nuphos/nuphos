// Known-answer vectors from Huawei's official SDK signer tests:
// huaweicloud-sdk-python-v3 huaweicloud-sdk-core/tests/test_signer.py (test_signer1/2)
// and huaweicloud-sdk-go-v3 core/auth/signer/signer_test.go (TestSigner_Sign).
export type HuaweiSignerVector = {
  name: string
  method: string
  url: string
  headers: Record<string, string>
  body: string
  ak: string
  sk: string
  expected: string
}

const PY_HEADERS = {
  Host: 'service.endpoint.myhuaweicloud.com',
  'X-Sdk-Date': '20200608T023900Z',
  TEST_UNDERSCORE: 'TEST_VALUE',
}

const GO_HEADERS = { 'X-Sdk-Date': '20060102T150405Z', TEST_UNDERSCORE: 'TEST_VALUE' }

const KEYS = { ak: 'AccessKey', sk: 'SecretKey' }

export const SDK_VECTORS: HuaweiSignerVector[] = [
  {
    name: 'python test_signer1',
    method: 'GET',
    url: 'https://service.endpoint.myhuaweicloud.com/resources?size=1',
    headers: PY_HEADERS,
    body: '',
    ...KEYS,
    expected:
      'SDK-HMAC-SHA256 Access=AccessKey, SignedHeaders=host;x-sdk-date, Signature=cfb4171acec81de07d50e53d57eb77edd537414d66ddb1d7d780f128e12cd842',
  },
  {
    name: 'python test_signer2',
    method: 'POST',
    url: 'https://service.endpoint.myhuaweicloud.com/resources?size=1',
    headers: PY_HEADERS,
    body: '{"name":"test","id":1}',
    ...KEYS,
    expected:
      'SDK-HMAC-SHA256 Access=AccessKey, SignedHeaders=host;x-sdk-date, Signature=436b1ac0a1ae03705934bb70ef2f2e09f7bfed2117d731a38235053199323a1f',
  },
  {
    name: 'go TestSigner_Sign test1',
    method: 'GET',
    url: 'https://example.huaweicloud.com/path?limit=1',
    headers: GO_HEADERS,
    body: '',
    ...KEYS,
    expected:
      'SDK-HMAC-SHA256 Access=AccessKey, SignedHeaders=x-sdk-date, Signature=5a2ce64c865e0e6046321c6f3d5a77ba8413eeaf355c3166c03d58d02ac79624',
  },
  {
    name: 'go TestSigner_Sign test2',
    method: 'POST',
    url: 'https://example.huaweicloud.com/path?key=value',
    headers: GO_HEADERS,
    // Go's json.Encoder terminates the body with a newline.
    body: '{"Name":"test","Id":1}\n',
    ...KEYS,
    expected:
      'SDK-HMAC-SHA256 Access=AccessKey, SignedHeaders=x-sdk-date, Signature=cecc2af119b18ab70b4d094c0750f3b42c02f254903179a0fc2cc72fc9db4f59',
  },
]

// test_process_canonical_query_string / TestSigner_canonicalQueryString.
export const QUERY_CASE = {
  params: [
    ['limit', '1'],
    ['enable', 'true'],
    ['test', '一 (&=?!#%.*)'],
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- a query value in the SDK's vector
    ['path', '/tmp/123'],
    ['multi', '3'],
    ['multi', '1'],
    ['multi', '2'],
  ] as [string, string][],
  expected:
    'enable=true&limit=1&multi=1&multi=2&multi=3&path=%2Ftmp%2F123&test=%E4%B8%80%20%28%26%3D%3F%21%23%25.%2A%29',
}

export const TOKEN_CASE = {
  method: 'GET',
  url: 'https://iam.myhuaweicloud.com/v3/projects?name=cn-north-4',
  ak: 'TEMPAK',
  sk: 'TempSecret',
  token: 'gQpjbi1ub3J0aC00token',
  date: '20260925T010203Z',
  isoDate: '2026-09-25T01:02:03Z',
}
