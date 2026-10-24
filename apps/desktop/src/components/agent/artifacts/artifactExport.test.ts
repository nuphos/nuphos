import assert from 'node:assert/strict'
import test from 'node:test'

import { EXPORT_POLICY, exportArtifact } from './artifactExport.ts'

import type { ArtifactVersion } from './artifactPayload.ts'
import type { FetchAsset } from './artifactExport.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

// A fake CDN: every fetch is recorded, and nothing leaves the test.
function cdn(files: Record<string, { type: string; body: string }>) {
  const asked: string[] = []
  const fetcher: FetchAsset = async (url) => {
    asked.push(url)
    const file = files[url]

    return file ? { contentType: file.type, bytes: bytes(file.body) } : null
  }

  return { asked, fetcher }
}

const version = (
  kind: ArtifactVersion['kind'],
  content: string,
  extra: Partial<ArtifactVersion> = {},
) =>
  ({
    artifactId: 'spend',
    title: 'Cluster spend, October',
    kind,
    content,
    toolCallId: 'c1',
    version: 2,
    ...extra,
  }) as ArtifactVersion

const PAGE = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.example.test">
<link rel="stylesheet" href="https://cdn.example.test/theme.css" integrity="sha384-x" crossorigin="anonymous">
<script src="https://cdn.example.test/chart.js" defer></script>
<style>body{background:url('https://img.example.test/bg.png')}</style>
</head><body>
<img src="https://img.example.test/logo.png" srcset="https://img.example.test/logo@2x.png 2x" alt="logo">
<div style="background-image:url(https://img.example.test/bg.png)">x</div>
<a href="https://example.test/billing">Billing</a>
<script>new Chart(document.body)</script>
</body></html>`

const FILES = {
  'https://cdn.example.test/theme.css': {
    type: 'text/css',
    body: "@import url('fonts.css');h1{color:red}",
  },
  'https://cdn.example.test/fonts.css': {
    type: 'text/css',
    body: "@font-face{font-family:X;src:url(./x.woff2) format('woff2')}",
  },
  'https://cdn.example.test/x.woff2': { type: 'font/woff2', body: 'FONT' },
  'https://cdn.example.test/chart.js': {
    type: 'text/javascript',
    body: 'window.Chart=function(){}',
  },
  'https://img.example.test/bg.png': { type: 'image/png', body: 'PNG' },
  'https://img.example.test/logo.png': { type: 'image/png', body: 'LOGO' },
}

test('a page downloads as one file with every asset inline and no way to fetch more', async () => {
  const { asked, fetcher } = cdn(FILES)
  const file = await exportArtifact(version('html', PAGE), fetcher)

  assert.equal(file.fileName, 'cluster-spend-october.html')
  assert.equal(file.mimeType, 'text/html')
  assert.deepEqual(file.missing, [])
  // Everything the page loads is now in the file itself.
  assert.match(file.content, /<script>window\.Chart=function\(\)\{\}<\/script>/)
  assert.match(file.content, /h1\{color:red\}/)
  assert.match(file.content, /src:url\("data:font\/woff2;base64,/)
  assert.match(file.content, /<img src="data:image\/png;base64,TE9HTw=="/)
  assert.match(file.content, /background-image:url\(&quot;data:image\/png;base64,/)
  // No load from the network remains: no remote src, stylesheet, url() or preconnect.
  assert.doesNotMatch(file.content, /\b(?:src|srcset|poster)\s*=\s*["']?(?:https?:)?\/\//i)
  assert.doesNotMatch(file.content, /<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//i)
  assert.doesNotMatch(file.content, /url\(\s*["']?(?:https?:)?\/\//i)
  assert.doesNotMatch(file.content, /integrity=|crossorigin=/)
  // Links still work: they open in the browser, they are not loads.
  assert.match(file.content, /<a href="https:\/\/example\.test\/billing">/)
  // And the file forbids anything it might still try.
  assert.ok(
    file.content.includes(`<meta http-equiv="Content-Security-Policy" content="${EXPORT_POLICY}">`),
  )
  assert.match(EXPORT_POLICY, /default-src 'none'/)
  assert.match(EXPORT_POLICY, /connect-src 'none'/)
  assert.match(file.content, /<meta name="viewport"/)
  assert.match(file.content, /<title>Cluster spend, October<\/title>/)
  // Each asset was fetched once, though bg.png is used twice.
  assert.equal(asked.filter((url) => url.endsWith('bg.png')).length, 1)
})

test('what cannot be fetched is listed, not silently dropped', async () => {
  const { fetcher } = cdn({})
  const page =
    '<script src="https://cdn.example.test/gone.js"></script><script>fetch("https://api.example.test/live")</script>'
  const file = await exportArtifact(version('html', page), fetcher)

  assert.deepEqual(file.missing.sort(), [
    'https://cdn.example.test/gone.js',
    'live data the page loads from the web',
  ])
})

test('a module that pulls more modules from the web is flagged', async () => {
  const { fetcher } = cdn({
    'https://esm.example.test/app.js': {
      type: 'text/javascript',
      body: 'import x from "https://esm.example.test/x.js"',
    },
  })
  const file = await exportArtifact(
    version('html', '<script type="module" src="https://esm.example.test/app.js"></script>'),
    fetcher,
  )

  assert.deepEqual(file.missing, [
    'https://esm.example.test/app.js (imports more modules from the web)',
  ])
})

test('documents and code download as they are, named after the title', async () => {
  const { asked, fetcher } = cdn({})
  const doc = await exportArtifact(
    version('markdown', '# Notes\n\n![x](https://img.example.test/a.png)'),
    fetcher,
  )
  const code = await exportArtifact(
    version('code', 'print(1)', { language: 'python', title: 'Idle volumes' }),
    fetcher,
  )

  assert.equal(doc.fileName, 'cluster-spend-october.md')
  assert.equal(doc.content, '# Notes\n\n![x](https://img.example.test/a.png)')
  assert.equal(code.fileName, 'idle-volumes.py')
  assert.equal(code.content, 'print(1)')
  assert.deepEqual(asked, [])
})

test('an SVG keeps its markup and inlines the images it references', async () => {
  const { fetcher } = cdn({
    'https://img.example.test/logo.png': FILES['https://img.example.test/logo.png'],
  })
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://img.example.test/logo.png" width="10" height="10"/></svg>'
  const file = await exportArtifact(version('svg', svg), fetcher)

  assert.equal(file.fileName, 'cluster-spend-october.svg')
  assert.match(file.content, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(
    file.content,
    /<image href="data:image\/png;base64,TE9HTw==" width="10" height="10"\/>/,
  )
  assert.deepEqual(file.missing, [])
})
