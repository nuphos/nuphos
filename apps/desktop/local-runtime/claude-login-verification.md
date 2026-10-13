# Local Claude sign-in verification (NUPS-877)

On macOS, `CLAUDE_CONFIG_DIR` stays in the Nuphos user's `claude-home`, while
`CLAUDE_SECURESTORAGE_CONFIG_DIR` selects the terminal's existing Keychain entry
(including custom terminal config directories). No credential is copied.
Linux and Windows keep their existing independent login. Login, probes and the Claude SDK process keep the host HOME so macOS can read
and write the login Keychain. On macOS the desktop adapter applies the isolated
HOME only when executing tool commands through `CLAUDE_CODE_SHELL_PREFIX`,
with login-shell startup and shell snapshots disabled. Provider CLI config paths
remain scoped to the conversation. Linux and Windows retain their existing
session environment. The adapter continues to isolate each conversation's tool HOME. No terminal credentials are
copied, and no credential is sent to the backend.

Automated tests cover environment isolation, login cancellation/retry/timeout,
late process events, verification after CLI exit, and reconnecting Claude without
stopping Codex. These tests do not prove macOS Keychain access or OAuth success.

## Manual acceptance on a Mac

Use a Desktop build containing this branch. Do not use the previously installed
Desktop build to assess the new UI. Keep the normal terminal Claude login intact.

1. First run (both create-workspace and join-workspace): when terminal Claude is
   already signed in on macOS, connect without another OAuth flow. When it is
   not signed in, show the local-agent setup. Offer sign-in and a
   clear "Continue to Nuphos" option to skip setup. The new-conversation screen and User settings →
   Local agent also offer sign-in.
2. Open sign-in. Confirm the browser opens, or use "Open Claude sign-in". Cancel
   once and retry. Close via Escape as well. A cancelled or failed attempt must
   not display a later success from its old process.
3. Finish browser authorization. Confirm the UI checks the login, reports
   connected, and the local Claude agent becomes selectable. Send a short message
   and verify a real response with Nuphos session HOME isolation enabled.
4. Quit and reopen Nuphos, then create another conversation. Neither operation
   should request another sign-in. Terminal Claude should use the same Keychain login on macOS.
5. With a disposable test account, expire its authorization. On macOS login
   changes affect terminal Claude too: never sign out a real account for this test. Trigger a conversation and verify the reauthentication card
   provides a direct sign-in button even for a non-admin owner of the local agent.
6. Reconnect and resend the failed message. Confirm an actual response. The app
   must not silently resend the prior prompt or switch it to another agent.
7. While sign-in is pending, log out of Nuphos or switch Nuphos accounts. The login
   process and any pending launch must be cancelled; the next account must not
   inherit a pending login process. macOS local agents use the device owner's
   existing Claude login, with separate Nuphos configuration.

Reconnecting Claude restarts the local Claude runtime and stops its current
conversations. The dialog states this before launching sign-in. Codex is not
restarted. Remote personal agents direct their owner to the hosting computer;
cloud-agent recovery retains the existing administrator flow.

Use a fresh Nuphos credential directory when checking first sign-in. An existing
`.credentials.json` can mask a broken Keychain write: a successful auth probe or
conversation with that file present does not prove first sign-in works. Do not
force a file-store fallback by changing the login HOME.

M1 / Claude Code 2.1.287 testing confirmed that changing login HOME makes fresh
OAuth fail to save its credentials. With the host HOME preserved, a real ACP
conversation using an empty config directory and the independent Nuphos
Keychain item succeeded without creating a credential file. Its Bash tool
reported session-scoped HOME, AWS and GitHub paths. Full first-run browser
completion and installed-app restart/reboot remain manual acceptance items.

## Optional cloud setup during onboarding

- Create and join flows offer cloud setup alongside local sign-in, including when
  Claude is already signed in or no local Claude CLI is installed.
- The copy explains that cloud conversations keep running when the computer is
  closed and can be continued from a phone; local conversations do not migrate.
- Continue without cloud setup. Confirm no cloud agent is created automatically.
- As an administrator, open cloud setup, cancel, and confirm the choice screen
  returns. Complete managed or self-hosted setup through the existing Add agent
  flow, then continue into the workspace.
- As a regular member, confirm setup explains that a workspace administrator is
  needed and does not attempt a creation request. Network errors should toast
  and allow retry.

## Review regression checks

- In both create and join onboarding, dismiss the agent setup with its header X:
  enter the workspace instead of remaining on “Setting up your workspace…”.
- Open local Claude sign-in within onboarding and press Escape while waiting:
  cancel sign-in and return to agent setup, without dismissing onboarding.
- Cause a sign-in failure, close the dialog and reopen it: show Try again without
  replaying the error toast. A new failed attempt should toast its specific
  main-process error (for example, a timeout).

## Existing-login verification (2026-10-09)

On an M1 with Claude Code 2.1.290, a fresh isolated config directory and the
terminal Keychain selector passed `claude auth status`, a real CLI prompt, and
installed Desktop ACP initialize → session/new → session/prompt with a Nuphos
session ID. ACP returned `end_turn`; Bash HOME and AWS_CONFIG_FILE pointed at
the conversation home. No `.credentials.json` was created and no OAuth was run.
This verifies Keychain reuse, not long-running concurrent token refresh or the
Linux/Windows file-backed login path.

## Upgrade behavior on macOS

Nuphos now uses the same Claude account as terminal Claude. Signing in through
Nuphos updates that shared login. Existing Nuphos-only Keychain entries are left
intact but are no longer selected; people who signed in only through an older
Nuphos version must sign in once if their terminal has no existing login.
