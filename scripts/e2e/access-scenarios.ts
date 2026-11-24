// Every scenario about who may use a binding or a team's Box, in the order they run.
import { bindingAccessScenarios } from './binding-access-scenarios.ts'
import { connectShareScenarios } from './connect-share-scenarios.ts'
import { departureScenarios } from './departure-scenarios.ts'
import { invitationScenarios } from './invitation-scenarios.ts'
import { listingScenarios } from './listing-scenarios.ts'
import { stagedGrantScenarios } from './staged-grant-scenarios.ts'
import { teamBoxAccessScenarios } from './team-box-access-scenarios.ts'

import type { Scenario } from './ui.ts'

export const accessScenarios: Scenario[] = [
  ...bindingAccessScenarios,
  ...connectShareScenarios,
  ...listingScenarios,
  ...invitationScenarios,
  ...departureScenarios,
  ...stagedGrantScenarios,
  ...teamBoxAccessScenarios,
]
