import { configMissingRule } from './rules/config-missing.ts'
import { crashLoopRule } from './rules/crash-loop.ts'
import { imagePullRule } from './rules/image-pull.ts'
import { outOfMemoryRule } from './rules/out-of-memory.ts'
import { probeFailureRule } from './rules/probe-failure.ts'
import { unschedulableRule } from './rules/unschedulable.ts'

import type { Rule } from './types.ts'

/**
 * The rules `diagnose` runs by default, in display order for equal severity.
 * Registration is this array and nothing else: a new rule is a new entry here
 * plus its fixtures, and a caller may pass its own array instead.
 */
export const BUILTIN_RULES: readonly Rule[] = [
  unschedulableRule,
  imagePullRule,
  configMissingRule,
  outOfMemoryRule,
  crashLoopRule,
  probeFailureRule,
]
