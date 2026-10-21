# Linked media preview

Files opened from a conversation link use the existing local-first lookup. Small files read inline; video, audio, PDFs and large images use `atlas:transferLinkedFile`. Electron resolves the explicit link on this computer first, prepares a temporary copy through the existing transfer store, and returns its origin. Missing local files fall back to the source runtime. Browsing the runtime still uses runtime-only APIs.

A local file over 512 KiB returns `file_too_large`, so its preview/download continues from that computer rather than falling through to a different runtime copy. The Files toolbar labels local previews “This computer”. The temporary copy is not attached to the conversation. Existing runtime path restrictions and transfer-size limits remain in force.

## Verification

- Node regressions cover local/remote lookup, spaces and Unicode, virtual-workspace traversal, upload failure without remote fallback, exact 512 KiB/empty files, all supported media families, refresh, pending-transfer cancellation, download reuse and over-limit responses.
- Browser checks render the production Files view and hook, calling the real local-transfer helper and runtime sandbox program through an isolated fixture bridge. Only transfer storage is stubbed. The generated video opens, plays, seeks and refreshes in both themes at 1440px and fits at 390px. Remote, missing and loading cases are exercised too. This is not a packaged Electron end-to-end test.
- Desktop build/typecheck and changed-file lint pass (lint has warnings).
- Final suite: 1,936 passed, one existing skip. `without any other install, the probe runs the desktop app copy` is explicitly excluded after reproducing the same failure on unchanged code: this Mac has the ChatGPT-bundled Codex CLI, while the test expects no Codex executable.

[Light comparison](images/linked-media-preview/light-before-after.png) · [Dark comparison](images/linked-media-preview/dark-before-after.png) · [Light 390px](images/linked-media-preview/light-390px.png) · [Dark 390px](images/linked-media-preview/dark-390px.png) · [Playback](images/linked-media-preview/playback.gif)

All evidence uses a generated test video and neutral paths. No user product, real conversation, or customer data is included.
