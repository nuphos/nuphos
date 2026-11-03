# Working on a shared computer

Share a spare computer with trusted teammates to keep team work running. Choose
who may use it from its access settings. A shared computer is a trusted working
environment, not a private sandbox for mutually untrusted members.

## What sharing grants

The `use` permission includes running conversations, commands, terminals, file
operations, browser/computer control and runtime sign-in (including local exec). The computer's OS
account determines which local files, existing sign-ins and services are
reachable. Share a dedicated team machine rather than a personal environment
containing unrelated private data.

`manage` also permits computer management and changing who may use it. The
owner retains ownership actions. Team membership or team-administrator status
does not by itself grant access to another member's personal computer.

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

## Removing access

Removing a grant prevents subsequent authorized access and attempts to close
existing streams. Already dispatched one-shot commands may finish, and stream
closure is best effort. Revocation cannot undo completed work or recover data
already read or copied. It is not a guarantee that every OS process stops
immediately. Revoke or rotate any separately issued credentials as needed.
