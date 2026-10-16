import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const toasts: { title: unknown; fallback?: string }[] = []
let page: () => Promise<{ url: string }>
const opened: string[] = []

mock.module('../../api.ts', {
  namedExports: {
    api: {
      boxBillingPage: () => page(),
      appOpenExternal: (url: string) => {
        opened.push(url)

        return Promise.resolve()
      },
    },
  },
})
mock.module('../../components/ui/toast.ts', {
  namedExports: {
    toast: {
      apiError: (title: unknown, _error: unknown, opts?: { fallback?: string }) => {
        toasts.push({ title, fallback: opts?.fallback })
      },
    },
  },
})

const { BILLING_UNREACHABLE, openBilling } = await import('./billing.ts')

test('an unreachable billing service toasts its fallback instead of failing silently', async () => {
  page = () => Promise.reject(new TypeError('fetch failed'))

  assert.equal(await openBilling('team', 12), false)
  assert.deepEqual(toasts, [{ title: 'Could not open billing', fallback: BILLING_UNREACHABLE }])
  assert.deepEqual(opened, [])
})

test('a reachable billing service opens its page', async () => {
  toasts.length = 0
  page = () => Promise.resolve({ url: 'https://checkout.test/pro' })

  assert.equal(await openBilling('team', 12), true)
  assert.deepEqual(opened, ['https://checkout.test/pro'])
  assert.deepEqual(toasts, [])
})
