import type { ProviderScreenshots, SetupScreenshot } from './types'

/** Trust is identical for both AWS roles, before any purpose-specific policy is
 *  attached, so the two purposes share this one. */
const AWS_TRUST_SCREENSHOT: readonly SetupScreenshot[] = [
  {
    src: '/aws-select-trusted-entity-example.png',
    alt: 'AWS IAM Select trusted entity page with Web identity selected, the nuphos.ai identity provider and sts.amazonaws.com audience chosen, and a StringEquals condition on nuphos.ai:sub',
    aspectRatio: '640 / 972',
  },
]

export const AWS_SCREENSHOTS: ProviderScreenshots = {
  operational: {
    'Create the identity provider': [
      {
        src: '/aws-create-identity-provider-example.png',
        alt: 'AWS IAM Add Identity provider form with OpenID Connect selected, the Provider URL set to https://nuphos.ai, and the Audience set to sts.amazonaws.com',
        aspectRatio: '640 / 720',
      },
    ],
    'Create the role & trust': AWS_TRUST_SCREENSHOT,
    'Add permissions': [
      {
        src: '/aws-add-permissions-example.png',
        alt: 'AWS IAM Add permissions page with the policy search filtered to AWSBillingReadOnlyAccess and that AWS managed policy checked',
        aspectRatio: '640 / 706',
      },
    ],
    'Name & create the role': [
      {
        src: '/aws-name-review-create-example.png',
        alt: 'AWS IAM Name, review, and create page with the Role name field set to NuphosRole',
        aspectRatio: '640 / 524',
      },
    ],
    'Bind the role': [
      {
        src: '/aws-role-summary-example.png',
        alt: 'AWS IAM summary page of the newly created NuphosRole, with the role ARN and its copy button in the Summary card',
        aspectRatio: '640 / 761',
      },
    ],
  },
}
