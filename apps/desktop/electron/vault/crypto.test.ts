import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  fingerprint,
  generateDeviceKey,
  open,
  publicKeyFromPrivate,
  seal,
  unwrap,
  validName,
  wrap,
} from './crypto.ts'

// Made by the CLI (`apps/cli/src/vault.rs`) for the private key 0x11 x 32 and
// the item key 0x22 x 32, so the two clients keep reading each other's items.
const CLI = {
  privateKey: Buffer.alloc(32, 0x11),
  publicKey: 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=',
  fingerprint: 'D19B-F3F0-8278-2C87-B783',
  wrapped:
    'DLhrFkE1hgChQy3jTc0W87HZBTGOjG0c/oUm4cAgBlvHWhJ3SaCq9zIcBSUFkR0fMWfD84axVHZj+0jveXqArLuWR5oTnwXsJd+rUT5M3Zo=',
  sealed: '62kjfgR0VtLvMfSScbFoakfj5xH1qgtso2+Ads8wl1bbsnejc3W1',
}

test('opens what the CLI wrapped and sealed', () => {
  const publicKey = publicKeyFromPrivate(CLI.privateKey)

  assert.equal(publicKey.toString('base64'), CLI.publicKey)
  assert.equal(fingerprint(publicKey), CLI.fingerprint)
  const itemKey = unwrap(CLI.wrapped, 'github-token', CLI.privateKey)

  assert.deepEqual(itemKey, Buffer.alloc(32, 0x22))
  assert.equal(open(itemKey, 'github-token', CLI.sealed).toString(), 'ghp_example')
})

test('an item round trips through a wrapped key', () => {
  const { privateKey, publicKey } = generateDeviceKey()
  const itemKey = Buffer.alloc(32, 7)
  const wrapped = wrap(itemKey, 'github-token', publicKey)

  assert.equal(Buffer.from(wrapped, 'base64').length, 32 + 32 + 16)
  assert.deepEqual(unwrap(wrapped, 'github-token', privateKey), itemKey)
  assert.equal(
    open(itemKey, 'github-token', seal(itemKey, 'github-token', Buffer.from('v'))).toString(),
    'v',
  )
})

test('a key or ciphertext moved to another name, or another device, does not open', () => {
  const { privateKey, publicKey } = generateDeviceKey()
  const other = generateDeviceKey()
  const itemKey = Buffer.alloc(32, 7)

  assert.throws(() => unwrap(wrap(itemKey, 'a', publicKey), 'b', privateKey))
  assert.throws(() => unwrap(wrap(itemKey, 'a', publicKey), 'a', other.privateKey))
  assert.throws(() => open(itemKey, 'b', seal(itemKey, 'a', Buffer.from('v'))))
})

test('a name cannot leave its path segment', () => {
  assert.ok(validName('github.token-2'))
  for (const bad of ['', '.', '..', '-x', 'a/b', 'a b', 'a'.repeat(129)])
    assert.ok(!validName(bad), bad)
})
