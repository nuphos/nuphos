import assert from 'node:assert/strict'
import test from 'node:test'

import { addedAccess, extensionName, installWarnings } from './warnings.ts'

test('install lines use Chrome wording, and always say browsing history', () => {
  assert.deepEqual(
    installWarnings({
      permissions: ['storage', 'nativeMessaging', 'clipboardWrite'],
      host_permissions: ['<all_urls>'],
    }),
    [
      'Read and change all your data on all websites',
      'Read your browsing history',
      'Modify data you copy and paste',
      'Communicate with cooperating native applications',
    ],
  )
  assert.deepEqual(
    installWarnings({ content_scripts: [{ matches: ['https://*.github.com/*'] }] }),
    ['Read and change your data on github.com', 'Read your browsing history'],
  )
})

test('an update adds access for new hosts and any new API permission', () => {
  const current = { permissions: ['storage'], host_permissions: ['https://*/*'] }

  assert.deepEqual(addedAccess(current, current), [])
  assert.deepEqual(addedAccess(current, { ...current, permissions: ['storage', 'cookies'] }), [
    'Use the "cookies" permission',
  ])
  assert.deepEqual(
    addedAccess(current, { ...current, host_permissions: ['https://*/*', 'http://*/*'] }),
    ['Read and change all your data on all websites'],
  )
  assert.deepEqual(
    addedAccess(
      { host_permissions: ['<all_urls>'] },
      { host_permissions: ['<all_urls>', 'https://example.com/*'] },
    ),
    [],
  )
})

test("a localized name comes from the extension's default locale", () => {
  const files = {
    '_locales/en/messages.json': new TextEncoder().encode(
      '﻿{"extName":{"message":"Bitwarden Password Manager"}}',
    ),
  }

  assert.equal(
    extensionName({ name: '__MSG_extName__', default_locale: 'en' }, files),
    'Bitwarden Password Manager',
  )
  assert.equal(
    extensionName({ name: '__MSG_missing__', default_locale: 'en' }, files),
    '__MSG_missing__',
  )
  assert.equal(extensionName({ name: 'Plain' }, files), 'Plain')
})
