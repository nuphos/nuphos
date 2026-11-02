// Step names, identity shapes, and input validation for the three clouds whose
// setup runs through a role rather than an API token.
//
// These live outside BindAccountDialog because react-refresh asks for it: a file
// cannot export both components and constants without breaking hot reload.

import { t } from '../i18n/index.ts'

export const AWS_STEPS = [
  t('Create the identity provider'),
  t('Create the role & trust'),
  t('Add permissions'),
  t('Name & create the role'),
  t('Bind the role'),
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

export function gcpSteps(_purpose: 'operational' = 'operational'): readonly string[] {
  return GCP_STEPS_CONSOLE
}

export function gcpContentStep(_purpose: 'operational', index: number): number {
  return index
}

export function gcpSpec(_purpose: 'operational') {
  const sa = 'nuphos-connector'

  return {
    sa,
    saEmail: `${sa}@PROJECT_ID.iam.gserviceaccount.com`,
    role: 'roles/iam.infrastructureAdmin',
    roleLabel: 'Infrastructure Admin',
  }
}

export const ARN_PATTERN = /^arn:aws:iam::\d{12}:role\/.+$/

export const SA_PATTERN = /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/

export const AZURE_GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export const GCP_STEPS_CONSOLE = [
  t('Enable APIs'),
  t('Create the service account'),
  t('Grant it project access'),
  t('Principals with access'),
  t('Let Nuphos impersonate it'),
  t('Enter details'),
] as const
