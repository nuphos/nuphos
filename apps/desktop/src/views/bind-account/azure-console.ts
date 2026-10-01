// The Azure portal pages the guide sends people to, and the names of the two
// objects it has them create there.
//
// Shared by both halves of the setup — the Entra ID steps that create the app
// and the subscription steps that grant it a role — because the second half
// tells the user to search for what the first half named. If those two ever
// disagree, the search comes back empty on a page where empty reads as "the app
// you made isn't here".

export const AZURE_APP_REGISTRATIONS_URL =
  'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
export const AZURE_ENTRA_OVERVIEW_URL =
  'https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview'
export const AZURE_SUBSCRIPTIONS_URL =
  'https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade'

export function azureAppName(_purpose: 'operational'): string {
  return 'Nuphos'
}

export function azureCredentialName(_purpose: 'operational'): string {
  return 'nuphos'
}
