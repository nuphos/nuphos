import assert from 'node:assert/strict'

import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { BucketRow } from './s3-bucket-rows'

const toasts: string[] = []

const realApi = await import('../../api')

mock.module('../../api', () => ({ ...realApi, api: { appOpenExternal: async () => {} } }))
mock.module('../../components/ui/toast', () => ({
  toast: { apiError: (title: string) => toasts.push(title) },
}))
mock.module('./s3-objects-table', () => ({
  S3ObjectsTable: ({
    rows,
    onRowClick,
  }: {
    rows: BucketRow[]
    onRowClick: (row: BucketRow) => void
  }) =>
    createElement(
      'ul',
      null,
      rows.map((row) =>
        createElement('li', { key: row.key, onClick: () => onRowClick(row) }, row.name),
      ),
    ),
}))
mock.module('./s3-object-preview', () => ({
  S3ObjectPreviewPanel: ({ onDownload }: { onDownload: () => void }) =>
    createElement('button', { id: 'download', onClick: onDownload }, 'Download'),
}))

test('a failed download says so and keeps the listing, also after a refresh', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    location: dom.location,
    navigator: dom.navigator,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const { createQueryClient } = await import('../../lib/query/client')
  const { S3BucketDetailView } = await import('./s3-bucket-detail')
  const container = dom.document.createElement('div')
  const root = createRoot(container as unknown as HTMLElement)
  const client = createQueryClient()

  // happy-dom reports the page offline, which would pause every query.
  onlineManager.setOnline(true)
  const render = (refreshKey: number) =>
    act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(S3BucketDetailView, {
            scope: 'test',
            bucketName: 'bucket',
            region: 'us-east-1',
            prefix: '',
            onNavigate: () => {},
            loader: async () => ({
              prefix: '',
              delimiter: '/',
              prefixes: [],
              objects: [
                { key: 'a.txt', size: 1, lastModified: null, storageClass: null, etag: null },
              ],
              isTruncated: false,
              nextContinuationToken: null,
            }),
            getDownloadUrl: () => Promise.reject(new Error('expired role')),
            filter: '',
            refreshKey,
            onCount: () => {},
          }),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  const listed = () => Array.from(container.querySelectorAll('li')).map((li) => li.textContent)
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

  try {
    await render(0)
    await settle()
    assert.deepEqual(listed(), ['a.txt'])

    await act(async () => {
      ;(container.querySelector('li') as unknown as HTMLElement).click()
    })
    await act(async () => {
      ;(container.querySelector('#download') as unknown as HTMLElement).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    assert.deepEqual(toasts, ['Failed to download object'])
    assert.deepEqual(listed(), ['a.txt'])

    await render(1)
    await settle()
    assert.deepEqual(listed(), ['a.txt'])
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
