# Android release artifacts

The manual **Android release artifacts** workflow builds a signed Android App
Bundle (AAB) for a maintainer to download. It does not upload to Play, publish a
GitHub Release, or change another platform's version. An AAB cannot be installed
directly like a debug APK.

## Administrator setup

Before production signing, a repository administrator must complete this setup
in the official `nuphos/nuphos` repository:

- Protect `main`. Review release source and its checks before starting a run.
- Create the `android-release` Environment. Require an authorized maintainer's
  approval, prevent self-review, disable administrator bypass, and allow only
  protected `main`. Verify these settings actually apply; a workflow reference
  alone does not enable protection.
- Set these **Environment secrets**: `ANDROID_UPLOAD_KEYSTORE_BASE64`,
  `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, and
  `ANDROID_UPLOAD_KEY_PASSWORD`. Use the upload key, never the debug or App
  signing key. Base64 encoding is not encryption.
- Set the **Environment variable** `ANDROID_UPLOAD_CERT_SHA256` to the approved
  upload certificate's SHA-256 fingerprint (64 hex characters, with optional
  colons). Check it against Play Console's upload certificate if already
  registered. For the first submission, approve and record the intended public
  upload certificate before registering it with Play.
- Keep an encrypted recovery copy of the upload key in the team's credential
  store, with two authorized custodians. GitHub Secrets are not the backup.

This workflow uses GitHub-hosted runners. It needs no Play service account,
Firebase project, GCP key or automatic store-upload permission.

## Build and download

1. Merge reviewed Android changes to official `main` after the required checks
   pass. Forks, PR refs, tags and other branches cannot run these jobs.
2. Open **Actions → Android release artifacts → Run workflow**, select `main`,
   and supply the reviewed version name and version code. Check Play Console
   and choose a code higher than **every** prior submission, including test
   tracks. CI validates the range (1–2100000000), but does not query Play's
   current version code. Never use the workflow run number as the version.
3. The build job runs Python and JVM tests, release lint and `bundleRelease`.
   Pinned bundletool validates the bundle and checks its actual package
   `ai.nuphos.android`, requested versions, minSdk 33 and targetSdk 36. The
   unsigned evidence artifact is available even if signing has not started.
4. Review the exact source commit and build result before approving the
   `android-release` Environment job. Signing uses only the immutable unsigned
   artifact ID from the same successful run. It performs no source checkout.
5. Download `android-signed-<run_id>-<attempt>` from that run within 14 days.
   It contains `Nuphos-Android-<version_name>-<version_code>.aab`,
   `SHA256SUMS.txt` and `metadata.json`. The metadata records the source commit,
   run and attempt, actual package/versions/SDK values, unsigned and signed
   SHA-256 checksums, and upload-certificate fingerprint.
6. Confirm the checksum (`sha256sum --check SHA256SUMS.txt` on Linux, or
   `shasum -a 256 --check SHA256SUMS.txt` on macOS). Inspect the JAR signature
   with JDK `jarsigner -verify -verbose -certs <bundle.aab>` and compare the
   certificate with the approved upload certificate. The workflow also reads
   every payload entry using JDK verification and rejects unsigned entries,
   duplicate entries, altered payloads and unexpected signers. A generic
   `jar verified` message alone does not prove all entries were signed.
7. Submit manually to the approved Play test track after release acceptance.
   This change does not approve a public rollout.

## Failure and retry

Missing configuration, invalid versions, failed tests/lint, bundle discrepancies,
wrong passwords and mismatched certificates stop the workflow. Signing failures
remove temporary key material and produce no signed artifact; no debug-signing
fallback exists. Secret command output is not printed. Check the four secret
names, keystore alias and approved public fingerprint in the protected
Environment; never paste key contents or passwords into a workflow log or issue.

Retry the **entire workflow** for a fresh build/sign pair. A signing-only rerun
fails the run-attempt provenance check. If Play has already received the version
code, use a new higher code on the next submission. After an upload-key reset,
update CI only when the replacement certificate is approved and registered.

## Local verification

Gradle preserves the existing local version defaults. Override them explicitly:

```sh
./gradlew --no-daemon -PnuphosVersionCode=2 -PnuphosVersionName=1.0.1 \
  :app:testDebugUnitTest :app:lintRelease :app:bundleRelease
python3 -m unittest discover -s scripts -p 'test_*.py'
```

Signing tests generate disposable test keys in temporary directories. They run
on Java 21 and test the exact signing script from the workflow, including failure
and cleanup paths. They do not use production secrets or prove GitHub's
Environment approval settings. An unsigned local AAB is not a Play upload
candidate.

References: [Android signing](https://developer.android.com/studio/publish/app-signing),
[bundletool](https://developer.android.com/tools/bundletool),
[JDK jarsigner](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jarsigner.html),
[GitHub Environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
