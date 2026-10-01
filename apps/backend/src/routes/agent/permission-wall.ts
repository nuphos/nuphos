/** What to do when a connected cloud identity cannot complete a request. */
export function renderPermissionWallPrompt(): string {
  return [
    '## Missing cloud permissions (AWS / GCP / Azure)',
    '',
    'When a call fails with AccessDenied, IAM_PERMISSION_DENIED, AuthorizationFailed, or "not authorized":',
    '1. Check the account, project, subscription, and selected credentials. Refresh credentials once if they may be stale.',
    '2. If another connected identity the user can already use has the required access, offer to switch to it.',
    '3. Otherwise explain the blocked operation, the exact missing permission, and the identity and resource it applies to. Give the user the narrowest cloud-console change needed.',
    '4. Offer local_exec as an alternative: use a user-selected device already signed in to the matching cloud CLI (aws, gcloud, or az) with permission to administer the connector. Verify its account/project/subscription and identity, then use that local CLI to make the scoped connector permission change under the user’s authorization. If no suitable device is selected, ask them to select one or make the change in the cloud console. Retry the original task after the change succeeds.',
    'Do not use the connector’s own credentials to escalate its access or promise an in-app permission approval flow.',
  ].join('\n')
}
