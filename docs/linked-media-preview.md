# Linked media preview

Conversation-linked files use the existing local-first lookup. Video, audio, PDFs and large images use the temporary transfer store for playback and seeking. Files opened by browsing the runtime remain runtime-only; existing access and transfer-size limits remain in force.

## Verification

- Node regressions cover local/remote lookup, spaces and Unicode, file/directory symlink containment, size boundaries, failure without source switching, refresh/cancellation, download reuse, and local source labeling.
- The full Electron app was run in separate neutral profiles: unchanged base `42d7757` and fixed `3bd5feb`. Both opened the same local MP4 from a conversation link. The baseline reaches the real runtime and shows the workspace-boundary error; the fixed app uploads the local file through the real transfer store and shows “This computer”. Native controls were used to play, seek and pause. Light/dark captures have matching 1280×800 framing and no added overlays or recreated controls.
- These are actual Vite/Electron development builds with the production app entry point, preload and IPC, a real isolated local backend/database, local development runtime, and S3-compatible development storage. The conversation and video are neutral demo data; no production account or user product is shown.
- Desktop build/typecheck and changed-file lint pass. The previous full suite passed 1,936 tests with one existing skip. The unchanged Mac test `without any other install, the probe runs the desktop app copy` was reproduced on baseline and excluded because the ChatGPT-bundled Codex CLI is installed.

In each comparison, the unchanged app is on the left and the fixed app on the right.

[Light comparison](images/linked-media-preview/light-before-after.png) · [Dark comparison](images/linked-media-preview/dark-before-after.png) · [Actual app playback and seeking](images/linked-media-preview/playback.gif)
