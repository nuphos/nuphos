---
name: firebase
description: Inspect Firebase project and registered-app inventory through a selected Google Cloud service-account binding, using short-lived WIF credentials and official REST APIs. No Firebase CLI authentication or deployment support.
---

# Firebase

Use the existing selected **gcp** credential and its exact projectId and
serviceAccountId. Firebase does not have a separate credential or selection.
Never access an unselected project, use a different account after a 403, request a
private key/server key, or enable Firebase/APIs/grant IAM as a side effect.

## Connect

Reuse a connected Google Cloud project, or connect an ordinary service account
through the existing Google Cloud WIF flow. Finish new connections with
`create_connector` provider `gcp`, passing the non-secret projectId and
serviceAccountEmail. Select that binding before requesting credentials. A GCP
connection does not prove Firebase is enabled; inspect the project first.

## Inspect

```bash
python3 skills/firebase/scripts/inspect.py TEAM_ID PROJECT_ID SERVICE_ACCOUNT_ID project
python3 skills/firebase/scripts/inspect.py TEAM_ID PROJECT_ID SERVICE_ACCOUNT_ID apps
# For the next page, pass only the returned page token:
python3 skills/firebase/scripts/inspect.py TEAM_ID PROJECT_ID SERVICE_ACCOUNT_ID apps --page-token PAGE_TOKEN
```

Each invocation fetches a fresh short-lived token through the same ordinary GCP
credentials endpoint as the gcloud setup script. The backend enforces session
selection, member ACL and the permission-admin prohibition. The helper calls only
the official Firebase Management API and prints a safe metadata projection.
Credentials stay in memory, never command arguments, output, or a private-key file.
Calls have timeouts and never follow redirects. Stop on any 403; do not retry with
another identity or endpoint. Do not treat a failed request as an empty inventory.

The project endpoint is `/teams/:teamId/gcp-projects/:projectId/firebase/project`;
the app endpoint is the same prefix with `/firebase/apps`. Both accept
`serviceAccountId`; apps also accepts `pageToken`. These return safe metadata using
the same binding. Do not call global `projects.list` from an agent: its results
could include projects outside the conversation selection.

## Capability and permission boundaries

| Service | This connector's implemented inventory | Required permission / distinction |
| --- | --- | --- |
| Management | Project metadata and state | firebase.projects.get; successful ACTIVE metadata confirms Firebase project availability |
| Apps | Registered apps, paginated | firebase.clients.list; not API keys or app config |
| Firestore | No dedicated Firebase inventory in this release | Official databases.list uses datastore.databases.list; data reads require separate permissions |
| Realtime Database | No dedicated inventory/data access in this release | Management instances.list uses firebasedatabase.instances.list; data REST additionally needs firebase.database and userinfo.email scopes, absent from the current handout |
| Authentication | No dedicated inventory/user access in this release | Official config inspection uses firebaseauth.configs.get; do not enumerate users by default |
| Hosting | No dedicated inventory/deploy in this release | Official sites.list uses firebasehosting.sites.list |
| Functions | No dedicated Firebase inventory/deploy in this release | Existing gcloud skill can inspect functions with cloudfunctions.functions.list and task authorization; do not claim all Cloud Run services are Firebase functions |
| Storage | No dedicated Firebase-linked bucket inventory in this release | Existing gcloud skill can inspect GCS with its granted IAM; Firebase-linked bucket list needs firebasestorage.buckets.list and projectNumber |

Management project/apps reads accept the existing cloud-platform OAuth scope;
IAM grants remain separate. Disabled Management API, permission denial, a missing
project and a successful empty app list are different results. A 404 does not
prove Firebase is disabled. Do not automatically enable APIs or add permissions.

Firebase CLI is **not configured or supported by this skill**. gcloud's
access_token_file is not ADC. Do not run `firebase deploy`, `firebase login:ci`,
or create a refresh daemon. Writes, deployments and deletions require the normal
task-specific authorization and a separately verified supported tool path.

Official references:
- https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/get
- https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/searchApps
- https://firebase.google.com/docs/projects/iam/permissions
- https://firebase.google.com/docs/database/rest/auth
- https://firebase.google.com/docs/cli
