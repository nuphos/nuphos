import assert from 'node:assert/strict'
import test from 'node:test'

import { webStoreItemId } from './webStore.ts'

test('Web Store item pages give their extension ID', () => {
  const id = 'nngceckbapebfimnlniiiahkandclblb'

  assert.equal(webStoreItemId(`https://chromewebstore.google.com/detail/bitwarden/${id}`), id)
  assert.equal(webStoreItemId(`https://chromewebstore.google.com/detail/${id}?hl=en`), id)
  assert.equal(webStoreItemId(`https://chrome.google.com/webstore/detail/x/${id}`), id)
  assert.equal(webStoreItemId(`https://chromewebstore.google.com.evil.example/detail/${id}`), null)
  assert.equal(webStoreItemId('https://chromewebstore.google.com/category/extensions'), null)
})
