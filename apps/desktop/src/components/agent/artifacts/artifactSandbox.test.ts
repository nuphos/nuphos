import assert from 'node:assert/strict'
import test from 'node:test'

import { artifactSrcDoc, parseArtifactClick, readArtifactFrameMessage } from './artifactSandbox.ts'

const bootstrapAt = (doc: string) => doc.indexOf('<base target="_blank">')

test('the bootstrap runs before anything the page loads', () => {
  const doc = artifactSrcDoc(
    '<!DOCTYPE html><html lang="en"><head><script src="https://cdn.example/x.js"></script></head><body></body></html>',
    'c1',
  )

  assert.ok(doc.startsWith('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'))
  assert.ok(bootstrapAt(doc) < doc.indexOf('cdn.example'))
  assert.ok(doc.includes('"c1"'))
})

test('a page without a head still gets one, after its doctype', () => {
  assert.ok(artifactSrcDoc('<html><body>x</body></html>', 'c').startsWith('<html><head><meta'))
  assert.ok(
    artifactSrcDoc('<!doctype html><body>x</body>', 'c').startsWith('<!doctype html><head><meta'),
  )
})

test('a fragment is wrapped in a standards-mode document', () => {
  const doc = artifactSrcDoc('<div>hi</div>', 'c')

  assert.ok(doc.startsWith('<!doctype html><html><head>'))
  assert.ok(doc.endsWith('<body><div>hi</div></body></html>'))
})

test('a <header> is not mistaken for the head', () => {
  const doc = artifactSrcDoc('<header>top</header>', 'c')

  assert.ok(doc.startsWith('<!doctype html>'))
  assert.ok(doc.includes('<body><header>top</header></body>'))
})

test('a <head> inside a comment or a script string is the page’s text, not its head', () => {
  const commented = artifactSrcDoc('<!-- <head> --><!doctype html><p>x</p>', 'c')

  assert.ok(commented.startsWith('<!-- <head> --><!doctype html><head><meta'))
  const scripted = artifactSrcDoc('<script>var t = "<head>"</script><p>x</p>', 'c')

  assert.ok(scripted.startsWith('<!doctype html><html><head><meta'))
  assert.ok(scripted.includes('<body><script>var t = "<head>"</script>'))
})

test('a comment before the head does not hide it', () => {
  const doc = artifactSrcDoc(
    '<!doctype html>\n<!-- made by the agent -->\n<html>\n<head><title>T</title>',
    'c',
  )

  assert.ok(doc.includes('<head><meta charset="utf-8"><meta name="viewport"'))
  assert.ok(doc.indexOf('<base') < doc.indexOf('<title>'))
})

test('a page gets a viewport only when it brought none, and defaults it can override', () => {
  const bare = artifactSrcDoc('<!doctype html><html><head><title>T</title></head></html>', 'c')
  const own = artifactSrcDoc(
    '<html><head><meta name="viewport" content="width=600"></head></html>',
    'c',
  )

  assert.ok(bare.includes('content="width=device-width,initial-scale=1,viewport-fit=cover"'))
  assert.ok(!own.includes('viewport-fit=cover'))
  assert.ok(bare.includes(':where(img,video,canvas){max-width:100%;height:auto}'))
})

test('only messages on the frame’s own channel are read', () => {
  assert.deepEqual(
    readArtifactFrameMessage({ nuphosArtifact: 'c', type: 'error', message: 'boom' }, 'c'),
    {
      channel: 'c',
      type: 'error',
      message: 'boom',
    },
  )
  assert.equal(
    readArtifactFrameMessage({ nuphosArtifact: 'other', type: 'error', message: 'x' }, 'c'),
    null,
  )
  assert.equal(readArtifactFrameMessage('boom', 'c'), null)
})

test('a click report is read, and a malformed one is dropped', () => {
  const report = { goto: 'next', text: 'Go', clickable: true, declared: true }

  assert.equal(
    readArtifactFrameMessage(
      { nuphosArtifact: 'c', type: 'click', message: JSON.stringify(report) },
      'c',
    )?.type,
    'click',
  )
  assert.deepEqual(parseArtifactClick(JSON.stringify(report)), report)
  assert.deepEqual(parseArtifactClick('{"goto":""}'), {
    goto: null,
    text: '',
    clickable: false,
    declared: false,
  })
  assert.equal(parseArtifactClick('not json'), null)
})

test('an arrow key the page left alone is reported, outside fields only', () => {
  const doc = artifactSrcDoc('<p>hi</p>', 'c')

  assert.equal(
    readArtifactFrameMessage({ nuphosArtifact: 'c', type: 'arrow', message: 'left' }, 'c')?.type,
    'arrow',
  )
  assert.ok(doc.includes("type:'arrow'"))
  assert.ok(doc.includes('event.defaultPrevented'))
  assert.ok(doc.includes('input,textarea,select'))
})
