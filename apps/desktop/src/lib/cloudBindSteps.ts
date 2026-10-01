// Step names, identity shapes, and input validation for the three clouds whose
// setup runs through a role rather than an API token.
//
// These live outside BindAccountDialog because two surfaces render the same
// setup — the settings modal and the first-run panel — and both have to agree
// on how many steps there are, what the connector is called, and what counts as
// a valid ARN. A second copy of any of it is a divergence waiting to happen.
// (It is also what react-refresh asks for: a file cannot export both components
// and constants without breaking hot reload.)

import { firstRunVocabulary } from './firstRunConnect.ts'

export const AWS_STEPS = [
  'Create the identity provider',
  'Create the role & trust',
  'Add permissions',
  'Name & create the role',
  'Bind the role',
] as const

export function awsSteps(_purpose: 'operational'): readonly string[] {
  return AWS_STEPS
}

export function awsContentStep(_purpose: 'operational', index: number): number {
  return index
}

export type AzureStepTitle =
  | 'Register the app & federated credential'
  | 'Assign a role on the subscription'
  | 'Bind the subscription'

export const azureSteps = (_purpose: 'operational'): readonly AzureStepTitle[] => [
  'Register the app & federated credential',
  'Assign a role on the subscription',
  'Bind the subscription',
]

/**
 * Whether the grant lands on the billing account rather than the project.
 *
 * True only for the first-run operational scope, which asks for
 * `roles/billing.viewer`. Both the step list and the step content branch on
 * this, and they have to branch on the *same* thing: titles from one procedure
 * over instructions from another is silent — every screen renders, they just
 * stop being about each other.
 */
export function gcpGrantsOnBillingAccount(purpose: 'operational', firstRun: boolean): boolean {
  return purpose === 'operational' && firstRun
}

export function gcpSteps(
  purpose: 'operational' = 'operational',
  firstRun = false,
): readonly string[] {
  const full = gcpGrantsOnBillingAccount(purpose, firstRun)
    ? GCP_STEPS_CONSOLE_FIRST_RUN
    : GCP_STEPS_CONSOLE

  return full
}

export function gcpContentStep(_purpose: 'operational', index: number): number {
  return index
}

export function gcpSpec(purpose: 'operational', firstRun = false) {
  const sa = 'nuphos-connector'
  const scope = firstRunVocabulary('gcp')

  return {
    isBroad: !firstRun,
    sa,
    saEmail: `${sa}@PROJECT_ID.iam.gserviceaccount.com`,
    role: firstRun ? scope.scopeGrant : 'roles/iam.infrastructureAdmin',
    roleLabel: firstRun ? scope.scopeLabel : 'Infrastructure Admin',
    grantOn: gcpGrantsOnBillingAccount(purpose, firstRun)
      ? ('billing-account' as const)
      : ('project' as const),
    scopeNote: firstRun ? scope.scopeNote : undefined,
  }
}

export const ARN_PATTERN = /^arn:aws:iam::\d{12}:role\/.+$/

export const SA_PATTERN = /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/

export const AZURE_GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export const GCP_STEPS_CONSOLE = [
  'Enable APIs',
  'Create the service account',
  'Grant it project access',
  'Principals with access',
  'Let Nuphos impersonate it',
  'Enter details',
] as const

/**
 * First run asks for `roles/billing.viewer`, whose lowest grantable resource is
 * the billing account — the project's role picker does not offer it at all. So
 * the grant cannot live inside Google's create-service-account wizard the way
 * the project-scoped one does, and both of that wizard's optional sub-steps are
 * left empty here. They collapse into the create step, and the grant becomes a
 * step of its own on the billing account's own page.
 */
export const GCP_STEPS_CONSOLE_FIRST_RUN = [
  'Enable APIs',
  'Create the service account',
  'Grant it billing access',
  'Let Nuphos impersonate it',
  'Enter details',
] as const
