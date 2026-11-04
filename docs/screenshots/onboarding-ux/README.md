# Onboarding UX preview

Screenshots captured from the desktop development app at a 1200 × 800 viewport (the home strip is cropped to its control).

- `01-workspace-name.png`: real naming components rendered with a demo identity; the submit button has keyboard focus and shows its Enter tooltip. No workspace is created for this capture.
- `02-runtimes-dev.png`: live runtime state in a development build connected to Nuphos Cloud. Local device registration remains disabled, so the screen explains why runtime detection is unavailable.
- `03-completion-skipped.png`: completion after skipping runtime setup, with workspace and runtime summaries, a return-to-setup action, Back, and Open workspace.
- `04-home-light.png`: light-theme composer and attached GitHub strip, cropped to exclude account information.

The development-only `onboardingSetup()` console helper replays runtime setup and completion without creating another workspace. `onboarding()` replays the full existing flow and still performs real workspace actions against the selected API.
