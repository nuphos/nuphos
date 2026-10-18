import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

// Execute the real hook with synchronous hooks and navigation boundary spies.
function setup() {
  const opened: { href: string; beside?: boolean }[] = []
  const external: string[] = []
  const source = readFileSync(new URL('./useWorkspaceChatLinks.tsx', import.meta.url), 'utf8')
  const exports: Record<
    string,
    (...args: unknown[]) => Record<string, (...args: unknown[]) => unknown>
  > = {}

  // Only repository-owned source is evaluated; no user or network input.
  // eslint-disable-next-line sonarjs/code-eval
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name: string) {
        if (name === 'react')
          return {
            useCallback: (fn: unknown) => fn,
            useMemo: (fn: () => unknown) => fn(),
            useEffect: () => undefined,
          }
        if (name.endsWith('/api'))
          return {
            api: {
              appOpenExternal: async (href: string) => {
                external.push(href)
              },
            },
          }
        if (name.endsWith('/appRoutes'))
          return {
            emptyNavigation: (_scope: unknown, page: string, params: { browserUrl: string }) => ({
              page,
              params,
            }),
            pageLocationForNavigation: (nav: { page: string; params: { browserUrl: string } }) => ({
              href: `${nav.page}?url=${encodeURIComponent(nav.params.browserUrl)}`,
            }),
          }
        if (name.endsWith('/external-link'))
          return {
            isBindableGithubLink: (href: string) =>
              /^https:\/\/github.com\/[^/]+\/[^/]+\/pull\/\d+/.test(href),
            appPathForExternalLink: () => '/bound/github/pull',
          }
        if (name.endsWith('/useStableCallback')) return { useStableCallback: (fn: unknown) => fn }
        if (name.endsWith('/WorkspacePaneContext'))
          return { useWorkspacePane: () => ({ active: true }) }
        if (name.endsWith('/useChatLinkMenuActions')) return { useChatLinkMenuActions: () => ({}) }

        return {}
      },
    },
  )
  const links = exports.useWorkspaceChatLinks({
    teamId: 'team',
    accountsByTeam: {},
    githubInstallationsByTeam: {},
    grafanaInstancesByTeam: {},
    openNuphosLinkInNewTab: (href: string, beside?: boolean) => {
      opened.push({ href, beside })

      return true
    },
  })

  return { links, opened, external }
}

const url = 'https://github.com/acme/app/pull/42/files#diff-1'

test('GitHub chat badges open the browser tab and retain deep links', () => {
  const { links, opened, external } = setup()

  assert.equal(links.openNuphosLinkFromChat(url), true)
  assert.deepEqual(opened, [{ href: `team.browser?url=${encodeURIComponent(url)}`, beside: false }])
  assert.deepEqual(external, [])
})

test('GitHub modifier click opens its browser tab beside the conversation', () => {
  const { links, opened, external } = setup()

  assert.equal(links.openNuphosLinkFromChat(url, true), true)
  assert.equal(opened[0]?.beside, true)
  assert.deepEqual(external, [])
})

test('linked GitHub badges use browser routing even for bound repositories', () => {
  const { links, opened, external } = setup()

  links.stableOpenSessionResource(url, false)
  assert.equal(opened[0]?.href, `team.browser?url=${encodeURIComponent(url)}`)
  assert.deepEqual(external, [])
})

test('explicit external action remains available on linked badges', () => {
  const { links, opened, external } = setup()

  links.stableOpenSessionResource(url, true)
  assert.deepEqual(opened, [])
  assert.deepEqual(external, [url])
})
