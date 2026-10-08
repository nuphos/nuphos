# Nuphos CLI

`nuphos` is a terminal client for Nuphos agent conversations. It talks to the
same API as the desktop and iOS apps (`POST /agent/chat` and its event stream),
and its layout follows the Codex CLI: finished output goes into the terminal's
own scrollback, and only the reply in progress, the composer and a status line
are redrawn.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/nuphos/nuphos/main/apps/cli/install.sh | sh
```

It installs the newest release for macOS or Linux (x86_64 and arm64) into
`~/.local/bin`, after checking its SHA-256. `NUPHOS_VERSION` pins a version
and `NUPHOS_INSTALL_DIR` changes the directory.

The TUI checks for a newer release when it starts and says so; `nuphos update`
installs it in place. `NUPHOS_NO_UPDATE_CHECK=1` turns the check off.

## Usage

```sh
nuphos                    # TUI: new conversation in the default team
nuphos resume [SESSION]   # TUI on a previous conversation, or a picker
```

It opens in the team used last (the first team the first time) and shows
which one; `/team` in the TUI, `nuphos team NAME` or `--team` switch it.

Getting started needs neither the desktop app nor the web. The first run
signs in through the browser and, if you are not in a team yet, asks for a
name and creates one. Then add an agent for it to run on:

```sh
nuphos team "Acme" --create           # create a team and make it the default
nuphos runtime claude-code --create   # add a Nuphos-managed Cloud agent and sign it in
nuphos runtime "Claude Code" --login  # sign a Cloud agent in again
```

`--create` takes `claude-code`, `codex`, `grok` or `antigravity`. Signing in
opens the provider's page; paste the code it shows back into the terminal.

Every TUI action is also a command that needs no terminal, for scripts and
other agents. `--json` prints machine-readable output.

```sh
nuphos exec "list the EKS clusters"          # send, print the reply, exit
echo "..." | nuphos exec --session ID        # continue a conversation
nuphos exec --approve --runtime Codex "..."  # allow commands needing approval
nuphos conversations                         # recent conversations
nuphos team [NAME] [--create]                # list teams / set the default / create
nuphos runtime [NAME] [--session ID]         # list agents / pick or move
nuphos runtime NAME --create | --login       # add a Cloud agent / sign one in
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

## Releasing

Bump `version` in `Cargo.toml`, merge, then push a matching tag on main:

```sh
git tag cli-v0.2.0 && git push origin cli-v0.2.0
```

`.github/workflows/release-cli.yml` builds the four binaries and publishes
them as the `CLI v0.2.0` GitHub Release, which the installer and
`nuphos update` pick up.

## Development

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
