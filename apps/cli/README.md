# Nuphos CLI

`nuphos` is a terminal client for Nuphos agent conversations. It talks to the
same API as the desktop and iOS apps (`POST /agent/chat` and its event stream),
and its layout follows the Codex CLI: finished output goes into the terminal's
own scrollback, and only the reply in progress, the composer and a status line
are redrawn.

## Usage

```sh
nuphos                    # TUI: new conversation in the default team
nuphos "check the pods"   # TUI, sending a first message
nuphos resume [SESSION]   # TUI on a previous conversation, or a picker
```

It opens in the team used last (the first team the first time) and shows
which one; `/team` in the TUI, `nuphos team NAME` or `--team` switch it.

Every TUI action is also a command that needs no terminal, for scripts and
other agents. `--json` prints machine-readable output.

```sh
nuphos exec "list the EKS clusters"          # send, print the reply, exit
echo "..." | nuphos exec --session ID        # continue a conversation
nuphos exec --approve --runtime Codex "..."  # allow commands needing approval
nuphos conversations                         # recent conversations
nuphos team [NAME]                           # list teams / set the default
nuphos runtime [NAME] [--session ID]         # list agents / pick or move
nuphos model [VALUE] [--effort E] [--session ID]
nuphos stop --session ID
nuphos login | logout
```

`exec` writes the reply to stdout and tool activity to stderr, ending with
the session id. A command that needs approval is denied unless `--approve` is
given; the exit status is 0, 1 on error, or 2 when an approval was denied.

Sign-in is shared with the desktop app: both read and write
`~/.config/nuphos/cli.yaml` (`NUPHOS_CLI_CONFIG` overrides it), and the API
endpoint saved on the desktop's sign-in screen (`cli.api-url`) applies here
too. `NUPHOS_API_URL` and `NUPHOS_TEAM` override the endpoint and the team, and
`NUPHOS_DEBUG_FRAMES=<file>` appends every stream event to a file.

In the composer:

| Key                    | Action                                |
| ---------------------- | ------------------------------------- |
| `enter`                | send                                  |
| `alt+enter` / `ctrl+j` | new line                              |
| `esc`                  | stop the reply                        |
| `y` / `n`              | answer a command waiting for approval |
| `/model`               | model and reasoning effort            |
| `/runtime`             | the agent the conversation runs on    |
| `/team`                | switch team                           |
| `/new`, `/resume`      | start or continue a conversation      |
| `/logout`, `/quit`     | sign out, exit                        |

Before the first message, `/model` changes the agent's default model, which is
what the desktop's new-conversation picker does too. For a Cloud agent that is
a team setting and needs an administrator.

## Development

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
