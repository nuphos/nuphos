import type { ProviderScreenshots } from './types'

/** Every Azure portal shot is one full blade at the same capture height, so they
 *  all declare the same box. */
const BLADE = '640 / 1031'

export const AZURE_SCREENSHOTS: ProviderScreenshots = {
  // Azure's two dense forms and the two panels of the role assignment. The
  // review shot names Cost Management Reader, which is the first-run grant; the
  // wider operational bind picks a broader role on the same page, so the picture
  // is right about the page and one line off about the choice — the same trade
  // AWS's 'Add permissions' shot already makes.
  operational: {
    'Register the app & federated credential': [
      {
        src: '/azure-register-app-example.png',
        alt: 'Azure portal Register an application form with the Name set to Nuphos, Supported account types on Single tenant only, and the Redirect URI left empty',
        aspectRatio: '640 / 881',
      },
      {
        src: '/azure-federated-credential-example.png',
        alt: 'Azure portal Add a credential form with the scenario set to Other issuer, the Nuphos issuer and subject filled in, Explicit subject identifier selected, and the credential named nuphos',
        aspectRatio: BLADE,
      },
    ],
    'Assign a role on the subscription': [
      {
        src: '/azure-select-members-example.png',
        alt: 'The Select members panel of Add role assignment, with nuphos typed into the search box and the Nuphos application as the only result',
        aspectRatio: BLADE,
      },
      {
        src: '/azure-review-role-assignment-example.png',
        alt: 'The Review + assign tab of Add role assignment, showing the role Cost Management Reader scoped to the subscription with the Nuphos application as its only member',
        aspectRatio: BLADE,
      },
    ],
    // Not a picture of our own form — the page the Directory (tenant) ID is
    // copied from. It is the one of the three IDs that lives somewhere the user
    // has not been yet, since the other two are on pages they just left.
    'Bind the subscription': [
      {
        src: '/azure-entra-overview-example.png',
        alt: 'The Microsoft Entra ID Overview page, with the Tenant ID and its copy button under Basic information',
        aspectRatio: '640 / 850',
      },
    ],
  },
}
