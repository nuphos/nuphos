---
name: grok-bot-export
description: Prepare a portable Nuphos Bot bundle from agents in Grok Bot, after reviewing which data the person wants to move.
---

# Prepare a Nuphos Bot bundle

Run these instructions in the source Grok Bot environment. The output is a ZIP
that the person reviews in Nuphos. You do not sign in to Nuphos, reconnect an
integration, or transmit anything to a destination server yourself.

## Review what will move

Identify the agents and group conversations that the person can access. Present
their names and explain which information you can actually read. Do not invent
unavailable settings or claim that a tool has exported data you cannot inspect.
Exclude this temporary export helper from the selection.

Ask which agents and groups to include, and separately whether to include their
working files. Show the approximate file count and bytes before that decision.
Keep working files out unless the person agrees. Do not collect another person's
private conversations merely because their agent appears in a group.

For each selected agent, collect its name, standing instructions, supported PNG
portrait, skill folders, scheduled prompts and selected files. For each selected
group, collect its name, shared instructions, selected members and ordinary lead
agent, if one exists. A lead does not confer additional permission.

Read accessible conversation context only to write concise background facts:
preferences, confirmed decisions and unfinished work. These are summaries, not
a transfer of messages, timestamps, tool logs or provider sessions. Label any
uncertainty rather than turning a guess into a fact.

## Keep accounts out of the bundle

Do not collect access tokens, cookies, passwords, SSH keys, provider logins,
OAuth grants, browser profiles, connector credentials or environment files.
Inspect instructions, skill files, filenames, URLs and working files for such
content. Replace references to a credential with a request to reconnect it in
Nuphos; never substitute a different live credential. Omit generated dependency
trees, version-control directories and nested archives.

The destination performs its own validation. Your inspection is not a guarantee
that arbitrary exported content is free of secrets. Report omitted or uncertain
files so the person can review them before importing.

## Write the format

Build a ZIP with `manifest.json` at its root. Use the following independent
Nuphos format. All keys contain lowercase letters, numbers and internal hyphens,
with at most 64 characters. Keys identify objects only inside this export; do
not use account IDs, destination session IDs or credentials as keys.

```json
{
  "format": "nuphos-bot-bundle",
  "version": 1,
  "source": {
    "application": "grok-bot",
    "exportedAt": "2026-11-11T00:00:00Z"
  },
  "bots": [{
    "key": "analyst",
    "name": "Analyst",
    "instructions": "Compare evidence, read {{file:notes.md}} and prepare cited briefs.",
    "avatar": "assets/analyst.png",
    "skills": [{ "key": "briefs", "directory": "skills/briefs" }],
    "memories": ["Weekly reports should include sources."],
    "files": [{ "path": "files/analyst/notes.md", "destination": "notes.md" }],
    "schedules": [{
      "key": "weekly-brief",
      "name": "Weekly brief",
      "prompt": "Prepare this week's brief.",
      "requestedEnabled": true,
      "timeZone": "Europe/Warsaw",
      "schedule": { "kind": "cron", "expression": "0 9 * * 1" }
    }],
    "manualTasks": [{
      "name": "New mail",
      "prompt": "Summarize new messages.",
      "reason": "Requires reconnecting the mail event source."
    }]
  }],
  "chats": [{
    "key": "research-desk",
    "name": "Research desk",
    "instructions": "Discuss evidence before choosing a recommendation.",
    "members": ["analyst"],
    "lead": "analyst",
    "memories": [],
    "schedules": [],
    "manualTasks": []
  }]
}
```

Use an actual ISO-8601 timestamp with an offset. Omit an unavailable `avatar` or
`lead`. Empty optional lists may be omitted. Every declared file must exist;
include no undeclared files. Skill folders must contain `SKILL.md` and their
support files. File paths and destinations must be relative, use `/`, and contain
no drive prefixes, empty segments, `.` or `..`. Replace each exported file's
absolute path in instructions and scheduled prompts with `{{file:destination}}`,
for example `{{file:notes.md}}`. Nuphos resolves that marker to the new Bot's
isolated imported directory. Do not claim that unexported absolute paths will
exist on the target computer; list them as manual setup.

Names have at most 120 characters, instructions/prompts 8,000, and each memory
500. At most 100 Bots, 100 groups, 100 memories per object, 64 skills and 64
schedules per Bot. Keep the ZIP below 100 MiB, expanded content below 500 MiB,
each file below 25 MiB and entries below 10,000. PNG portraits must be at most
512 KiB and 2048 pixels on either side. Do not include links or special files.

Schedules use five-field cron with the original IANA time zone, or
`{"kind":"interval","seconds":3600}` for an actual elapsed interval of at least
180 seconds. Do not convert a local time to a fixed UTC offset or invent cron
for an event-driven task. Each original schedule gets its own key. Keep event
definitions in `manualTasks` without secret webhook URLs. Record requested state
accurately; Nuphos still requires a separate activation confirmation.

Write the completed ZIP to a temporary filename first, then rename it to its
final name. Report the location, selected objects, omissions and unresolved
items. Explain that the person must review the destination, files and schedule
effects in Nuphos. Do not say the migration or reconnection is already complete.
