# Nuphos CLI

`nuphos` is a terminal client for Nuphos agent conversations. It talks to the
same API as the desktop and iOS apps (`POST /agent/chat` and its event stream),
and its layout follows the Codex CLI: finished output goes into the terminal's
own scrollback, and only the reply in progress, the composer and a status line
are redrawn.

## Usage

```sh
cargo run --release              # new conversation
cargo run --release -- resume    # pick a previous conversation
cargo run --release -- login     # sign in through the browser
cargo run --release -- logout
```

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
