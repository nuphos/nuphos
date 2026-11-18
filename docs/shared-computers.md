# Working on a shared computer

Share a spare computer with trusted teammates to keep team work running. Choose
who may use it from its access settings. A shared computer is a trusted working
environment, not a private sandbox for mutually untrusted members.

## What sharing grants

`use` lets a teammate run their conversations on the computer's agents. Those
agents run with the computer's own Claude Code or Codex sign-in, so teammates'
chats count against that account's plan and usage limits. The agents act as the
computer's OS account: through their own tools they can read the files and run
the commands that account can. Share a dedicated team machine rather than a
personal environment containing unrelated private data.

`manage` also permits Nuphos's own device tools (local exec, file upload and
browser/computer control), opening a terminal, signing the computer's agents in
or out, computer management, and changing who may use it. The owner of a computer
from Nuphos can let teammates who only use it open a terminal too. The owner retains
ownership actions. Team membership or team-administrator status does not by
itself grant access to another member's personal computer.

Inviting someone to a conversation that runs on a computer they cannot use asks
whether to give them `use` of that whole computer. Removing them from the
conversation later does not take that back.

Slack, Discord, scheduled triggers and agent threads can run work where the person
accountable for that work has computer access. They are not categorically
blocked by their source.

## Privacy on the host

Session-specific HOME and CLI configuration paths help prevent accidental
configuration mixing. They are not an OS or filesystem security boundary:
processes may still run as the same OS user. On macOS, session configuration may
link to that account's Keychains. This does not mean every Keychain secret can
be read without authorization, but it is not a private per-session Keychain.

Host administrators and processes with the same OS-account access may read work
sent to the machine, including conversation context, files and credentials.
Do not send work there if you do not trust that environment or its operators.
Selecting another runtime or moving a conversation can send its context to the
destination host; it does not make that content private from the host.

Computer access does not automatically grant permission to open someone else's
full conversation in Nuphos. This application permission does not protect local
artifacts from the host administrator or other same-account processes. Local
runtime conversations currently allow only their conversation owner to send
messages, even when the computer is shared.

## Device-operation records

Computer owners and managers may inspect supported device-operation records.
Ordinary `use` permission does not grant audit access. Records include the
requesting participant, conversation owner and title, session, source, command
summary, timestamps and outcome. They do not grant access to the full transcript.

Device-operation records have a 90-day retention policy, enforced by a backend
TTL index; expired records can remain until its next cleanup. Command summaries
are bounded and obvious secret patterns are masked on a best-effort basis. This
is not a guarantee that arbitrary secrets are removed. Full file contents and
tool outputs are not collected by this device-operation audit by default.

Coverage is incomplete. Native coding-agent tools, activity outside Nuphos and
all operating-system access are not comprehensively observed. Audit persistence
is best effort; a write failure does not necessarily stop the operation. An
unfinished record has an unknown outcome, not proof of success or failure.
These records are not a tamper-proof or complete security log.

## Automatic updates

A computer Nuphos runs for your workspace keeps Nuphos on itself on the newest
release. When a new release is out and none of its agents has run a turn for 10
minutes, Nuphos restarts the computer's Nuphos service on the new version, the
same as **Update** on its agent's card. The restart ends every conversation and
terminal open on the computer; idle only means its agents are not working, so a
program you started yourself, such as a dev server, stops too. An update that does
not take is not tried again until the next release.

A team administrator can turn this off in Settings > General > Automatic updates
(or with `PUT /teams/<team>/box-auto-update` and `{"enabled": false}`). A computer
on a Nuphos too old to run conversations is still updated. A computer whose owner
can no longer control it is never updated on its own, since Nuphos cannot check
whether its agents are busy; update it from its card.

## Removing access

Removing a grant prevents subsequent authorized access and attempts to close
existing streams. Already dispatched one-shot commands may finish, and stream
closure is best effort. Revocation cannot undo completed work or recover data
already read or copied. It is not a guarantee that every OS process stops
immediately. Revoke or rotate any separately issued credentials as needed.
