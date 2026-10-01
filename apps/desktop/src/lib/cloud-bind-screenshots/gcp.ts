import type { ProviderScreenshots, SetupScreenshot } from './types'

/** The project switcher does not care what the service account is for, so both
 *  GCP purposes point at the same shot. */
const GCP_PROJECT_ID_SHOT: SetupScreenshot = {
  src: '/gcp-project-id-example.png',
  alt: 'The Google Cloud project switcher open on the Select a resource dialog, with the current project row showing its ID in the ID column',
  aspectRatio: '640 / 477',
}

// The guide mirrors Google's own pages one step at a time. Steps that span two
// pages get two shots, captioned so the reader is not matching pictures to
// instructions by position.
export const GCP_SCREENSHOTS: ProviderScreenshots = {
  operational: {
    'Enable APIs': [
      {
        src: '/gcp-enable-resource-manager-api-example.png',
        alt: 'Google Cloud Product details page for the Cloud Resource Manager API, with the blue Enable button below the description',
        aspectRatio: '640 / 586',
      },
      {
        src: '/gcp-enable-iam-api-example.png',
        alt: 'Google Cloud Product details page for the Identity and Access Management (IAM) API, with the blue Enable button below the description',
        aspectRatio: '640 / 586',
      },
    ],
    'Create the service account': [
      {
        src: '/gcp-create-service-account-example.png',
        alt: 'Google Cloud Create service account wizard on sub-step 1, with the service account name and ID both set to nuphos-connector and the Create and continue button below',
        aspectRatio: '640 / 753',
      },
    ],
    'Grant it billing access': [
      {
        src: '/gcp-billing-account-management-example.png',
        alt: "A billing account's Account management page, showing the billing account ID, the projects linked to it, and the Add principal button on the permissions panel",
        aspectRatio: '640 / 579',
      },
      {
        src: '/gcp-grant-billing-access-example.png',
        alt: 'The Add principal panel on the billing account, with the nuphos-connector service account entered under New principals and Billing Account Viewer picked as the role',
        aspectRatio: '640 / 785',
      },
    ],
    'Let Nuphos impersonate it': [
      {
        src: '/gcp-grant-token-creator-example.png',
        alt: 'The Grant access panel on the nuphos-connector service account, with the Nuphos platform service account entered under New principals and Service Account Token Creator picked as the role',
        aspectRatio: '640 / 820',
      },
    ],
    'Enter details': [
      {
        src: '/gcp-service-account-email-example.png',
        alt: 'Google Cloud Service accounts list, with the nuphos-connector row showing the full service account email in the Email column',
        aspectRatio: '640 / 601',
      },
      GCP_PROJECT_ID_SHOT,
    ],
  },
}
