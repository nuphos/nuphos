import assert from 'node:assert/strict'
import test from 'node:test'

import { isChatMenuLink } from '../../components/agent/chatLinkMenuContext.ts'
import { pageLocationForNavigation, emptyNavigation } from '../../lib/appRoutes.ts'

import { buildChatLinkMenuActions } from './chatLinkMenuActions.ts'

type Calls = { external: string[]; inNewTab: string[]; copied: string[] }

function setup(opts: { teamId?: string | null; handledInApp?: boolean } = {}) {
  const calls: Calls = { external: [], inNewTab: [], copied: [] }
  const actions = buildChatLinkMenuActions({
    teamId: opts.teamId === undefined ? 'team1' : opts.teamId,
    copyLink: (href) => {
      calls.copied.push(href)

      return Promise.resolve()
    },
    openExternalLink: (url) => calls.external.push(url),
    openNuphosLinkFromChat: () => opts.handledInApp ?? false,
    openNuphosLinkInNewTab: (href) => {
      calls.inNewTab.push(href)

      return true
    },
  })

  return { actions, calls }
}

test('an app link opens through the left-click routing and nothing else', () => {
  const { actions, calls } = setup({ handledInApp: true })

  actions.openInApp('/teams/team1/agent')
  assert.deepEqual(calls, { external: [], inNewTab: [], copied: [] })
})

test('a plain web page opens in the built-in browser tab when there is a team', () => {
  const { actions, calls } = setup()

  actions.openInApp('https://example.com/docs')
  const expected = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId: 'team1' }, 'team.browser', {
      browserUrl: 'https://example.com/docs',
    }),
  ).href

  assert.deepEqual(calls.inNewTab, [expected])
  assert.deepEqual(calls.external, [])
})

test('a plain web page falls back to the system browser without a team', () => {
  const { actions, calls } = setup({ teamId: null })

  actions.openInApp('https://example.com/docs')
  assert.deepEqual(calls.external, ['https://example.com/docs'])
  assert.deepEqual(calls.inNewTab, [])
})

test('copy and external open use the absolute URL for a relative app path', () => {
  const { actions, calls } = setup()

  actions.copyLink('/teams/team1/agent')
  actions.openExternal('/teams/team1/agent')
  actions.copyLink('https://example.com/a')
  assert.deepEqual(calls.copied, ['https://nuphos.ai/teams/team1/agent', 'https://example.com/a'])
  assert.deepEqual(calls.external, ['https://nuphos.ai/teams/team1/agent'])
})

test('the menu only applies to web pages and in-app paths', () => {
  assert.equal(isChatMenuLink('https://example.com'), true)
  assert.equal(isChatMenuLink('/teams/team1/agent'), true)
  assert.equal(isChatMenuLink('/workspace/src/app.ts'), false)
  assert.equal(isChatMenuLink('mailto:a@example.com'), false)
})
