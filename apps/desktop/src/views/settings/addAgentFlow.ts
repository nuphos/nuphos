export type AddAgentStep = 'choose' | 'self-hosted' | 'self-hosted-password' | 'managed'
export type AddAgentAction = 'self-hosted' | 'managed' | 'use-password' | 'use-pairing' | 'back'

export function nextAddAgentStep(step: AddAgentStep, action: AddAgentAction): AddAgentStep {
  switch (action) {
    case 'self-hosted':
    case 'use-pairing':
      return 'self-hosted'
    case 'use-password':
      return step === 'self-hosted' ? 'self-hosted-password' : step
    case 'managed':
      return 'managed'
    case 'back':
      return step === 'self-hosted-password' ? 'self-hosted' : 'choose'
  }
}
