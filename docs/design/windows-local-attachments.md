# Windows local attachment delivery

## Problem and evidence

On the official Desktop 0.85.0 Windows ARM64 build, an authenticated local Claude Code agent rejects a successfully uploaded PNG with `Update this agent to support native file attachments`. The failure occurs before model output. NUPS-1113 records the production reproduction and request IDs.

Three assumptions cause the failure: Desktop excludes Windows from OpenAB's whitespace-separated runtime job configuration; the downloader hardcodes `/tmp`; and the POSIX backend rejects Windows absolute paths. Merely removing the Windows capability gate leaves the remaining failures intact.

## Prior art and design

- Nuphos's `LocalFileStream`, `DeviceRuntimeSocket`, runtime capability reporting, and instance-scoped workspaces already implement bounded operations over an authenticated reverse tunnel. Attachment delivery reuses that transport with an explicit `attachments` purpose and `localAttachments` capability rather than changing the read-only file channel.
- [Node child process documentation](https://nodejs.org/download/release/v22.23.3/docs/api/child_process.html) distinguishes direct executable/argument invocation from shell command interpretation. The new host stream invokes Electron/Node with an argument array and an explicit environment; paths containing whitespace do not need shell quoting.
- [Microsoft CreateProcess documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/creating-processes) reinforces explicit process/handle boundaries. No shell or arbitrary command is introduced.
- Norman Hardy's [The Confused Deputy (1988)](https://www.cs.umd.edu/~jkatz/security/downloads/capabilities.html) motivates keeping authority attached to a specific operation. The peer sends a bounded file list; the desktop chooses its own bundled program, workspace and environment. This is a design application of the paper, not a claim that it prescribes this implementation.
- [RFC 8252, OAuth 2.0 for Native Apps](https://www.rfc-editor.org/info/rfc8252/) recommends an external browser and protecting authorization codes. Nuphos continues to delegate authentication and token exchange to the official CLI; its dialog supports the official `/cai/oauth/authorize` path and forwards a manually pasted code only to the active child's stdin. It does not retain codes in status or logs or implement a separate OAuth client.

## Compatibility and boundaries

The backend resolves the existing control endpoint before selecting the attachment transport. A local host must advertise the dedicated capability; an older Desktop or hosted runtime retains the existing allowlisted job fallback. An advertised attachment operation that fails is reported as a failure rather than silently retried through a different privilege path. A backend update and a Desktop update are required for Windows.

The attachment stream selects the workspace for the exact agent instance, uses only the bundled downloader, caps input/output and execution time, and kills its child on cancellation. The local root is selected by the host and passed as an argument, never read from backend environment variables or accepted from the peer. Downloads live under that workspace instead of a temporary job directory that disappears before model execution. Each new local download reclaims batches older than seven days, preserving recent batches and unrelated directories. Cleanup occurs when another attachment is prepared; it is not a periodic cleanup service. Filenames are normalized for Windows reserved characters/device names, trailing dots/spaces and component length; prompt display names remain unchanged. Both drive-letter and POSIX paths are converted with the appropriate platform semantics on the backend. The generic `panel` runner remains unavailable on personal computers.

## Validation

Focused tests cover real file download through the backend/host tunnel, whitespace and Unicode paths, caller attempts to substitute a program/environment/root, old-client fallback, Windows file URI conversion, and sign-in code submission/cancellation.

`scripts/windows-attachment-e2e.ts` bundles the actual backend/host protocol into a standalone Windows validation program. It uses an in-memory backend bus and a tiny local HTTP fixture, not a production backend deployment. By default it requires no production credentials; an optional third CLI path argument uses the caller’s existing Claude sign-in to read the downloaded PNG and verify the response. It verifies bytes and file URI conversion using the Windows Electron Node executable. On 2026-10-21 the Windows ARM64 VM returned `passed: true` and the real Claude CLI answered `Red`. Full packaged Desktop-to-deployed-backend validation remains a separate release check.
