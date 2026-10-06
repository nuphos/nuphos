# Releases

Desktop, Backend and iOS have independent versions in their `apps/*/package.json`
files. Release workflows publish software for download, self-hosting or
TestFlight; they do not deploy the hosted service.

## Release a component

1. Merge a version-only PR after the required CI checks pass. Use a Patch for
   fixes and other changes, or a Minor when adding features. Major versions need
   an explicit maintainer decision and an `X.0.0` baseline.
2. Tag that reviewed commit on `main`: `vX.Y.Z` for Desktop, `backend-vX.Y.Z`
   for Backend or `ios-vX.Y.Z` for iOS. The version must exactly match the
   component's package version.
3. Push the tag. The corresponding release workflow validates the version and
   checks that the commit belongs to `main` before publishing.

To retry, run the corresponding workflow manually with the existing release
**tag** selected. A manual run on a branch will skip publication. Forks also
skip publication. Do not move an existing release tag; publish a new version
when the source changes. Maintainers must restrict creation and deletion of
`v*`, `backend-v*` and `ios-v*` tags with repository rulesets.

## Desktop

`release-desktop.yml` builds macOS (arm64 and x64), Windows (x64 and arm64),
and Linux AppImages (x64 and arm64), including the pinned local runtime.
macOS builds must be signed and notarized. Windows and Linux builds are unsigned.
Artifacts and update manifests use the S3 publish destination already defined in
`apps/desktop/package.json`. A GitHub Release links to the downloads only after
all platform builds succeed. A failed platform can leave other platforms already
published; retry the same tag to finish it.

Before the first release, a repository administrator must configure the
`desktop-release` GitHub Environment:

- Require maintainer approval, prevent self-review, and disable administrator
  bypass. Allow deployments only from the protected `v*` release tags.
- Store `MAC_CERTS` (base64 Developer ID certificate), `MAC_CERTS_PASSWORD`,
  `APPLE_API_KEY_BASE64` (base64 App Store Connect `.p8` key), `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, and `APPLE_TEAM_ID` as Environment secrets.
- Store `AWS_RELEASE_ROLE_ARN` as an Environment secret. Configure the role to
  trust GitHub Actions OIDC only for this repository and `desktop-release`, with
  audience `sts.amazonaws.com`. Match the repository's actual subject format,
  including immutable owner and repository IDs when enabled. Scope permissions
  to uploading release objects and reading the macOS update manifest in the
  configured distribution prefix. The workflow obtains short-lived credentials;
  do not configure long-lived AWS keys or production deployment credentials.

Do not store secret values in the workflow, documentation, repository variables,
or repository-level secrets. The notarization key is written to a private
runner-temporary file and removed after packaging. External pull requests never
run this release workflow. The macOS update manifest carries Darwin 21 as its
minimum system version, matching macOS 12 in the package configuration.

## Self-hosted Backend image

`release-backend.yml` publishes the existing `apps/backend/Dockerfile` for
`linux/amd64` and `linux/arm64` as:

```text
ghcr.io/nuphos/backend:vX.Y.Z
```

The workflow uses the repository's built-in `GITHUB_TOKEN` with `packages: write`;
no cloud credentials are needed. After the image is published successfully, a
GitHub Release records the image reference and digest with automatically generated
release notes. Backend releases do not replace the Desktop latest release. The Dockerfile copies only application source,
locked production dependencies and scripts, not deployment configuration.

Configure the `backend-release` Environment with maintainer approval, no
self-review or administrator bypass, and only protected `backend-v*` tags.
GitHub packages are private by default on first publication: an administrator
must set this package's visibility to **public** and verify an anonymous pull
before advertising it for self-hosting. There is no floating `latest` tag; pin a
version (or the published digest) in your deployment.

Building this image does not modify the Compose development stack or any hosted
production deployment. Production deployment configuration and credentials are
managed independently.

## iOS

`release-ios.yml` archives the app with the version in `apps/ios/package.json`,
uploads it to TestFlight, and adds it to the **External Beta** group, which
submits it for Beta App Review. The build number is the run's UTC minute
(`YYYYMMDDHHMM`), so it keeps increasing past builds uploaded before this
workflow existed. A build that is still processing after 30 minutes is left for
a maintainer to attach by hand. No GitHub Release is created.

Configure the `ios-release` Environment with maintainer approval, no self-review
or administrator bypass, and only protected `ios-v*` tags. Store these as
Environment secrets:

- `APPLE_API_KEY_BASE64` (base64 App Store Connect `.p8` key), `APPLE_API_KEY_ID`
  and `APPLE_API_ISSUER`.
- `APPLE_DIST_CERT_P12_BASE64` and `APPLE_DIST_CERT_PASSWORD`, the Apple
  Distribution identity, created once and reused so builds never request new
  certificates.
- `APPLE_APPSTORE_PROFILE_BASE64`, the App Store provisioning profile for
  `ai.nuphos.ios`. If it lacks Push Notifications, the build ships without push
  and the run warns.
