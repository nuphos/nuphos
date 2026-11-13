# Team ZIP migration

A team administrator can open **Settings → General → Data migration → Export
ZIP** in Desktop. The confirmation explains that the archive contains private
team content. Choose where to save the ZIP; cancelling the save dialog does not
start an export.

**Import ZIP into a new team** opens a native file picker, verifies the ZIP and
shows the source name, historical member identities and reconnect list. Select
your source identity explicitly, or leave every author historical. Confirm
**Create imported team**; then choose the new team from the team switcher.

Import always creates a new team. It cannot target, merge into or overwrite an
existing team. The importer is its sole administrator. Invite teammates after
completion; historical roles do not grant membership. Email-domain auto-join
and local computer sharing are reset. Triggers and dashboard schedules remain
disabled. Runtime sessions, credentials and computers must be reconnected.

## Included data

One team's portable settings and default layout, current and former membership
attribution, team instructions, team memories/playbooks, UTF-8 skill source,
conversation text and sender attribution, Bot/group-chat relationships, Plans,
dashboard/panel source, diagrams, designs, and conversation-owned triggers.
Triggers retain only their owning conversation reference (`targetSessionId`),
without source user ownership, creator, or execution-principal fields, and remain disabled.
On import, the stored Trigger `userId` is derived from its remapped Task owner
(the importer), so it can be listed, edited and deleted through the Task APIs.
This does not restore an independent Trigger owner or source execution authority.

The archive uses `manifest.json` with `format: "nuphos-team"` and
`formatVersion: 1`. It records the backend version, source team, export time,
and record counts, uncompressed byte lengths and SHA-256 for every part.
Structured records use NDJSON; settings, the member directory and the exclusion
report use JSON. IDs identify the source and must be mapped by an importer.

Bot definitions remain conversation records; `work/bots.ndjson` is their
conversation-ID index. Trigger records retain `targetSessionId` and are always
exported disabled. Runtime-owned one-shot wakeups have no portable backend
schedule record and are listed as excluded.

## Exclusions and privacy

The ZIP does not contain application-managed credentials, even their encrypted
forms, sign-in sessions, runtime attachments, execution approvals, pending work,
workspace archives, file binaries, tool payloads, traces, journal chains,
personal knowledge, billing or telemetry. `not-migrated.json` lists reconnect
categories, connector references and unavailable items. It creates no bindings.

Scripts and conversation text are user-authored content. They may contain pasted
secrets; the export does not promise to find or redact them. Keep the ZIP private.
External links and URLs embedded in authored content still point to their source;
file links are not made portable. Panel static parameters are excluded because
they are unrestricted structured payloads; reconfigure them before execution.

Database reads share a MongoDB snapshot. Deployments that cannot provide snapshot
reads fail the export instead of silently producing an inconsistent copy. Skill
files are read conditionally against their listed ETags, checked again after the
copy, and fail the export if the listing changes. The source keeps running; this
is a copy, not a cutover or sync.

## Limits and API

- 100 MiB ZIP; 500 MiB total expanded content; 100,000 serialized records.
- 5 MiB per record; 1 MiB per UTF-8 skill file. Binary/oversized skill assets are
  explicitly listed as excluded. Other limit violations fail the entire export.
- No splitting or silent truncation. A private temporary archive is completed
  before any successful download and removed when the response stream closes.

`POST /teams/:teamId/migration/export` requires a signed-in administrator.
Conversation, agent-run and CLI tokens cannot use it. It returns
`application/zip` with `Cache-Control: no-store`. No public link or persistent
background export job is created. Audit events record actor, team, counts,
archive digest and outcome, without content.

## Import contract and atomicity

`POST /teams/migration/preview` accepts an `application/zip` body and returns the
verified manifest, SHA-256, member directory and exclusion list without writing
a destination. `POST /teams/migration/import` accepts the same bytes, the preview
digest in `X-Migration-SHA256`, and optionally `X-Migration-Source-Member` naming
one source member to map to the signed-in importer. Other identities are freshly
allocated historical IDs, never existing destination accounts. Both endpoints
require a signed-in user session; CLI and conversation tokens are refused.

Every destination record gets a new ID, except plan numbers, which are retained
within the new team's independent counter. Typed references are rewritten;
authored text and external links are not. Conversation, plan-requester and dashboard/panel custody belongs to the
importer and source participant grants are cleared. Source message metadata is
stored as historical provenance and is never replayed as trusted server-authored
attribution. The visible transcript labels imported authors.

Validation refuses unsafe ZIP paths, symlinks, encryption, unknown entries or
versions, duplicate source IDs, unknown record fields, invalid references and
checksum/size mismatches. Validation completes before destination writes.
Skill objects are staged with conditional creates under a fresh team namespace;
the new team, its sole membership, records and import receipt commit in one Mongo
transaction. No other request can access that team before commit. A conflict or
failure rolls back the entire database import; existing content is untouched.
The deployment must support MongoDB transactions. Failed imports clean their
staged objects; uncertain commit outcomes retain objects to protect committed
teams. There is no maintenance mode, merge, overwrite or automatic member invite.

The import receipt records historical members, ID attribution, resets and the
source reconnect report. The original ZIP's `not-migrated.json` remains the
portable checklist. Only import archives you trust: restoring authored scripts
and instructions is an explicit content import, not a security review of them.

Preview and import allow one in-flight request per account and at most two per
backend replica. These are resource bounds, not a distributed mutation fence.
The archive limits are upper bounds: the server's MongoDB transaction lifetime
(default 60 seconds) can impose a smaller practical import size. An import that
exceeds it aborts atomically. A process crash before commit can leave unreferenced
skill objects under an invisible team namespace; automatic orphan sweeping is
out of scope. Legacy group chats containing Task participants are refused with
an actionable error; remove those participants and export again.
