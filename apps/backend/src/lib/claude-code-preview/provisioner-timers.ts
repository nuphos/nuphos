type TimerState = {
  warmup?: ReturnType<typeof setTimeout>
  reconcile?: ReturnType<typeof setInterval>
}

// Bun --hot re-evaluates modules without necessarily destroying timers owned
// by the previous module instance. A global handle lets the replacement module
// cancel its predecessor instead of running two reconcilers against one spec.
const provisionerGlobal = globalThis as typeof globalThis & {
  nuphosClaudeCodeProvisionerTimers?: TimerState
}

function state(): TimerState {
  if (!provisionerGlobal.nuphosClaudeCodeProvisionerTimers) {
    provisionerGlobal.nuphosClaudeCodeProvisionerTimers = {}
  }

  return provisionerGlobal.nuphosClaudeCodeProvisionerTimers
}

export function clearProvisionerTimers(): void {
  const timers = state()

  if (timers.warmup) clearTimeout(timers.warmup)
  if (timers.reconcile) clearInterval(timers.reconcile)
  delete timers.warmup
  delete timers.reconcile
}

export function setProvisionerTimers(
  warmup: ReturnType<typeof setTimeout>,
  reconcile: ReturnType<typeof setInterval>,
): void {
  const timers = state()

  timers.warmup = warmup
  timers.reconcile = reconcile
}
