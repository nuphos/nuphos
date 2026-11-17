// Scenarios about team-wide listings that read every binding at once.
import {
  client,
  connectGitlab,
  gitlabBindingId,
  joinAsAdmin,
  must,
  startFixtureGitlab,
} from './binding-access-scenarios.ts'

import type { Flow } from './binding-access-scenarios.ts'
import type { Scenario } from './ui.ts'

// A team-wide listing follows each binding's own rule: an admin off its list sees a shared
// binding, never another member's private one.
export async function adminListingFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const gitlab = await startFixtureGitlab(4444)

  try {
    const { memberId: listedId } = await joinAsAdmin(stack, owner)
    const { member: admin, memberId: adminId } = await joinAsAdmin(stack, owner)

    log(`admins ${listedId} and ${adminId} joined`)
    must(
      (await connectGitlab(stack, owner, gitlab.url, 'listing-code')).status === 200,
      'GitLab to connect',
    )
    const bindingId = await gitlabBindingId(stack, owner, gitlab.url)
    const path = `/teams/${stack.teamId}/gitlab-bindings`
    const listed = async () =>
      JSON.stringify((await admin('GET', `${path}/namespaces`)).body).includes(bindingId)
    const ownerId = (
      (await owner('GET', `${path}/${bindingId}/access`)).body as {
        memberAllowList: string[]
      }
    ).memberAllowList[0]!

    must(!(await listed()), 'the other admin not to see the private binding in namespaces')
    log('private: the admin off its list does not see it in namespaces')

    const shared = await owner('PUT', `${path}/${bindingId}/access`, {
      memberAllowList: [ownerId, listedId],
    })

    must(shared.status === 200, `the owner to share it, got ${String(shared.status)}`)
    must(await listed(), 'the other admin to see the shared binding in namespaces')
    must(
      (await admin('GET', `${path}/${bindingId}/token`)).status === 200,
      'the other admin to use the shared binding directly too',
    )
    log('shared with one teammate: the admin off its list sees it, as its own routes allow')
  } finally {
    gitlab.close()
  }
}

export const listingScenarios: Scenario[] = [
  {
    name: 'an admin sees shared bindings in team-wide listings, never a private one',
    run: async (_page, stack) => adminListingFlow(stack),
  },
]
