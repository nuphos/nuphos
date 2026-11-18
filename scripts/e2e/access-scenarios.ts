// Every scenario about who may use a binding, in the order they run.
import { bindingAccessScenarios } from './binding-access-scenarios.ts'
import { connectShareScenarios } from './connect-share-scenarios.ts'
import { listingScenarios } from './listing-scenarios.ts'

import type { Scenario } from './ui.ts'

export const accessScenarios: Scenario[] = [
  ...bindingAccessScenarios,
  ...connectShareScenarios,
  ...listingScenarios,
]
