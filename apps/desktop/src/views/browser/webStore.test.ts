import assert from 'node:assert/strict'
import test from 'node:test'

import { addableExtensionId, webStoreItemId } from './webStore.ts'

test('Web Store item pages give their extension ID', () => {
  const id = 'nngceckbapebfimnlniiiahkandclblb'

  assert.equal(webStoreItemId(`https://chromewebstore.google.com/detail/bitwarden/${id}`), id)
  assert.equal(webStoreItemId(`https://chromewebstore.google.com/detail/${id}?hl=en`), id)
  assert.equal(webStoreItemId(`https://chrome.google.com/webstore/detail/x/${id}`), id)
  assert.equal(webStoreItemId(`https://chromewebstore.google.com.evil.example/detail/${id}`), null)
  assert.equal(webStoreItemId('https://chromewebstore.google.com/category/extensions'), null)
})

test('a Web Store item page offers its extension until it is added', () => {
  const id = 'aeblfdkhhhdcdjpifhhbdiojplfjncoa'
  const page = `https://chromewebstore.google.com/detail/1password/${id}`

  assert.equal(addableExtensionId(page, []), id)
  assert.equal(addableExtensionId(page, [{ id: 'nngceckbapebfimnlniiiahkandclblb' }]), id)
  assert.equal(addableExtensionId(page, [{ id }]), null)
  assert.equal(
    addableExtensionId('https://chromewebstore.google.com/category/extensions', []),
    null,
  )
})
