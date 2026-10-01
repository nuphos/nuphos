---
name: file-transfer
description: Move files between the user and the sandbox/cluster through Nuphos's short-lived transfer store. Use when the user uploaded files for you to work on, or when you produced/fetched a file the user should download. Pull user uploads into the sandbox; push files out so the user can download them (single files or a zip).
---

# File transfer

Nuphos has a temporary, S3-backed transfer store that ferries files between
the user and agent workflows. You never touch buckets or credentials — these
scripts call the backend, which hands back short-lived signed URLs, and the
file moves **directly between the sandbox and S3**.

Two directions:

- **Pull** — the user uploaded files (an `upload` transfer group). Pull them
  into the sandbox to work on them.
- **Push** — you produced or fetched a file (e.g. `kubectl cp` from a pod,
  or a report you generated). Push it out as a `download` group; a download
  card then appears in the user's conversation.

## Critical cost rule

The transfer store is **fully decoupled from this sandbox's lifecycle**.
Always push a finished file out **during the current turn**, while the
sandbox is already alive — never assume the sandbox will still exist later
for the user to "pull from it". Once pushed to the store, the file lives in
S3 with its own TTL and the user can download it long after this sandbox is
gone. Pulling an upload likewise happens within the active turn.

## Auth (same pattern as other skills)

```bash
# Helper: authenticated call to the backend, scoped to this agent session.
ft() {
  local method="$1" path="$2"; shift 2
  curl -fsSL -X "$method" \
    -H "Authorization: Bearer $NUPHOS_TOKEN" \
    -H "Content-Type: application/json" \
    "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/agent-sessions/${NUPHOS_SESSION_ID}/teams/${TEAM}/file-transfers${path}" "$@"
}
```

`$TEAM` is the team id — get it from the `nuphos-api` skill
(`GET /teams`) if you don't already have it. `$NUPHOS_TOKEN` and
`$NUPHOS_SESSION_ID` are already in the environment.

## Pull user uploads into the sandbox

When the user attaches files, the conversation gives you a transfer
**groupId**. Pull it:

```bash
bash skills/file-transfer/scripts/transfer-pull.sh <TEAM> <groupId> <dest-dir>
# downloads every ready file into <dest-dir>, preserving relative paths
```

If some files are still uploading/failed the script reports them; re-run to
pick up late arrivals.

### Attached images (vision) you need as actual files

Images the user attaches are shown to you as **vision** — you can see them, but
their bytes are NOT in the sandbox. When the user wants the actual image file
moved or saved (e.g. `kubectl cp` it into a pod, or write it to disk), call the
**`upload_attachment`** tool with the `attachmentId` from the `[Attached image …]`
note in the message. It returns a `groupId`; pull it like any other upload:

```bash
bash skills/file-transfer/scripts/transfer-pull.sh <TEAM> <groupId> ./uploads
```

Never ask the user to re-upload an image they already attached — use
`upload_attachment`.

### Folder / multi-file uploads come as one archive

The desktop uses a **hybrid** upload model:

- A **single file** is uploaded as-is — pull it normally.
- A **folder or multi-file** selection is packed into ONE `.zip` object (this
  avoids many tiny objects, the file-count cap, and OS junk like `.DS_Store`).

For the archive case the conversation message tells you so and includes
`--extract`. Pass it and the script unpacks the zip **in place** (via python's
`zipfile`, so no `unzip` binary is required) back into the original tree, then
removes the zip:

```bash
bash skills/file-transfer/scripts/transfer-pull.sh <TEAM> <groupId> ./uploads --extract
# pulls assets.zip, extracts it → ./uploads/assets/... , removes the zip
```

Just follow the pull command given in the message; you don't decide the model.

## Push files out for the user to download

```bash
# One or more discrete files → the user gets per-file download + "download all as zip"
bash skills/file-transfer/scripts/transfer-push.sh <TEAM> ./report.csv ./chart.png

# A whole directory → preserves the tree
bash skills/file-transfer/scripts/transfer-push.sh <TEAM> ./output/

# Large tree (hundreds of files) → zip it in the sandbox first and push ONE
# archive. Cross-platform: plain `zip` here produces a UTF-8, mac+Windows
# friendly archive (Linux zip adds no __MACOSX/._ junk).
zip -r -X /tmp/results.zip ./output/ >/dev/null
bash skills/file-transfer/scripts/transfer-push.sh <TEAM> /tmp/results.zip
```

The script prints the resulting **groupId** and a one-line summary.

**Keep the user-facing reply minimal.** Once the push succeeds, a download
card renders in the conversation on its own — do NOT explain the mechanism
(transfer store, S3, "download area", group ids, or that "a card will
appear"). A short confirmation is enough, e.g. "Done — 404.html is ready to
download." or just "Done ✅". The card speaks for itself; the user does not
need to know how the transfer works.

### When to zip in the sandbox vs let the desktop zip

- **A few discrete files** → push them individually. The desktop offers both
  per-file download and a local "download all as zip", so the user chooses.
- **A large directory / many files** → `zip` it here first and push the
  single archive. This avoids hundreds of separate objects and is faster.

## Failure handling

The scripts surface explicit errors: `file_too_large`, `too_many_files`,
`transfer_too_large`, `transfer_expired`, `file_transfer_unconfigured`,
`transfer_not_found`. If the store is unconfigured (`503
file_transfer_unconfigured`), tell the user file transfer isn't enabled on
this deployment rather than retrying.

## Safety

- Never push secrets/credentials out as downloadable files unless the user
  explicitly asked for that file.
- Respect the size limits; if a file is rejected as too large, tell the user
  the limit instead of silently truncating.
