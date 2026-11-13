# Team ZIP export

A team administrator can open **Settings → General → Data migration → Export
ZIP** in Desktop. The confirmation explains that the archive contains private
team content. Choose where to save the ZIP; cancelling the save dialog does not
start an export.

This is the export slice of team migration. Import into an empty self-hosted team
is a separate implementation; this change does not modify a destination.

## Included data

One team's portable settings and default layout, current and former membership
attribution, team instructions, team memories/playbooks, UTF-8 skill source,
conversation text and sender attribution, Bot/group-chat relationships, Plans,
dashboard/panel source, diagrams, designs, and conversation-owned triggers.
Triggers retain only their owning conversation reference (`targetSessionId`),
without user ownership, creator, or execution-principal fields, and remain disabled.

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
