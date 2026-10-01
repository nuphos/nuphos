# Runtime deletion and conversation moves

Conversations belong to Nuphos. Deleting a managed runtime saves each attached
conversation's workspace, then removes the Deployment, Service, credential
Secret, PVC, and backing PV. The conversation ID, messages, owner, permissions,
and memory association remain in the platform.

Deletion returns HTTP 202. The runtime stays visible as deleting until cleanup
finishes. `agent_runtime_deletions` records progress per environment; the existing
runtime provisioner retries pending work. A failed archive or resource identity
check leaves the remaining resources intact. Credential bindings and defaults
are removed only after every registered environment finishes. Old orphaned PVCs
created before this feature are not automatically deleted.

The backend needs the volume observer RBAC in
`deploy/openab-runtime-provisioner.yaml`. It only reads cluster-scoped PVs. The
volume must use the **Delete** reclaim policy and reference the expected PVC UID.
The backend uses foreground Deployment deletion, waits for PVC and PV removal,
and never removes finalizers or force-deletes a disk. Kubernetes' storage
controller owns backing disk deletion; see its
[Persistent Volumes documentation](https://kubernetes.io/docs/concepts/storage/persistent-volumes/).

## Moving a conversation

The owner can choose **Move runtime** in the existing conversation and select
another enabled, signed-in runtime of the same agent type:

- **History and workspace** saves the live source's files, or restores its saved
  archive if the source is gone. Both file transfer endpoints must be managed
  runtimes in the current environment.
- **Conversation history only** also works for conversations whose old runtime
  was removed before backups existed. Missing files are not recovered.

Both options start a fresh native agent and reconstruct context from the stored
conversation on its next turn. Native Claude/Codex process state, background
processes, and native checkpoints are not imported. Nuphos history and permissions
remain unchanged. The conversation's captured model defaults are preserved.

The move restores files before committing its new attachment. Failed restores
leave the original attachment intact. Existing destination files are never
overwritten; retries accept an already restored workspace only if it still
matches the archive. Active turns reject moves. Production requires shared Redis
run coordination; the local Kubernetes development launcher can use its single
process admission guard. A durable conversation operation marker blocks new
turns during the move and expires after ten minutes if its worker crashes.

Moves retain the previous workspace locations internally, including history-only
moves. Deleting an old runtime still saves those workspaces after the conversation
has moved. History-only moves do not require the source runtime to be online.

The current conversation attachment is shared in MongoDB, not scoped by
environment. Both move modes therefore reject a provisioner-managed source in another Kubernetes
namespace before changing any conversation state. Move production conversations
from production and development conversations from development. This feature does
not make native sessions portable between environments. Credential bindings are
also shared: binding or deleting a managed runtime affects all its registered
environments, while each controller manages only its own namespace's resources.

## Archive storage and limits

Archives use MongoDB GridFS (`agent_workspace_files`) with team-scoped manifests
in `agent_workspace_archives`. They have no TTL and do not use the temporary S3
file transfer bucket. Include these collections in the platform's database
backup and retention policy.

Only `/workspace/conv-<conversationId>` is exported. Runtime home directories,
account tokens, SSH configuration, injected credentials, and other conversations
are not copied. Workspace files themselves are user data and may contain secrets.
Archives are limited to 64 MiB of file contents and 10,000 entries per conversation.
Relative links inside the conversation are supported; links outside it and
special files pause deletion. Restoration validates paths, duplicate entries,
content checksums, sizes, and conversation identity before replacing an empty
workspace with a staged directory. Files outside the conversation directory
cannot be recovered by this mechanism.

Mongo placement leases serialize provisioning and deletion across replicas.
Kubernetes mutations recheck lease ownership and deletes carry UID preconditions.
Each environment processes only server-derived placements in its own namespace.
