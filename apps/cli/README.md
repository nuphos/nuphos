# Nuphos CLI

`nuphos` is a terminal client for Nuphos agent conversations. It talks to the
same API as the desktop and iOS apps (`POST /agent/chat` and its event stream),
and its layout follows the Codex CLI: it takes over the whole terminal, the
conversation scrolls above a composer pinned to the bottom, and a reply streams
in full rather than in a fixed-height box.

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

A new conversation opens on a home screen with the shortcuts; typing anything
switches to the conversation. `ctrl+\` (`ctrl+4` in terminals without the
kitty keyboard protocol) lists your conversations as the desktop's sidebar does (Pinned, Shared, Chats;
`p` pins or unpins, in the same favorites), and
switching away from a reply leaves it running on the server.

It opens in the team used last (the first team the first time) and shows
which one; `/team` in the TUI, `nuphos team NAME` or `--team` switch it.

Getting started needs neither the desktop app nor the web. The first run
signs in through the browser and, if you are not in a team yet, asks for a
name and creates one. Then add an agent for it to run on:

```sh
nuphos team "Acme" --create           # create a team and make it the default
nuphos agents claude-code --create    # add a Nuphos-managed Cloud agent and sign it in
nuphos agents "Claude Code" --login   # sign a Cloud agent in again
```

`--create` takes `claude-code`, `codex`, `grok` or `antigravity`. Signing in
opens the provider's page; paste the code it shows back into the terminal.

Every TUI action is also a command that needs no terminal, for scripts and
other agents. `--json` prints machine-readable output.

```sh
nuphos exec "list the EKS clusters"          # send, print the reply, exit
echo "..." | nuphos exec --session ID        # continue a conversation
nuphos exec --approve --agent Codex "..."    # allow commands needing approval
nuphos conversations                         # recent conversations
nuphos team [NAME] [--create]                # list teams / set the default / create
nuphos agents [NAME] [--session ID]          # list agents / pick or move
nuphos agents NAME --create | --login        # add a Cloud agent / sign one in
nuphos model                                 # list the agent's models
nuphos model [VALUE] [--effort E] --session ID
nuphos stop --session ID
nuphos login | logout
nuphos agent                                 # run this computer's agents
```

`nuphos agent` makes this computer a local agent, as the desktop app does: the
Claude Code and Codex you already have installed show up in every team you
belong to while it runs. Only you can start a conversation on them, but once
you move a conversation onto this computer, anyone in that team can continue
it, and their messages run commands here, as you. It needs Node.js 22 or newer. On first
use it downloads the runtime for this release (openab and the ACP adapters)
into `~/.local/share/nuphos/runtime`. On macOS it reuses your terminal Claude
login; if none exists, it asks you to sign in to that shared login. Linux and
Windows use a separate Claude sign-in for Nuphos. Codex uses your `codex login`. It
runs as its own device, so the desktop app on the same computer is unaffected;
`NUPHOS_LOCAL_RUNTIME_DIR` points it at a locally staged runtime instead.

`exec` writes the reply to stdout and tool activity to stderr, ending with
the session id. A command that needs approval is denied unless `--approve` is
given; the exit status is 0, 1 on error, or 2 when an approval was denied.

Sign-in is shared with the desktop app: both read and write
`~/.config/nuphos/cli.yaml` (`NUPHOS_CLI_CONFIG` overrides it), and the API
endpoint saved on the desktop's sign-in screen (`cli.api-url`) applies here
too. `NUPHOS_API_URL` and `NUPHOS_TEAM` override the endpoint and the team, and
`NUPHOS_DEBUG_FRAMES=<file>` appends every stream event to a file.

In the composer:

| Key                    | Action                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `enter`                | send                                                                                                  |
| `alt+enter` / `ctrl+j` | new line                                                                                              |
| `esc`                  | stop the reply, or back to the latest                                                                 |
| `↑` / `↓`, mouse wheel | scroll the conversation                                                                               |
| `pgup` / `pgdn`        | scroll a page                                                                                         |
| `ctrl+\`               | sessions: switch to another conversation                                                              |
| `y` / `n`              | answer a command waiting for approval                                                                 |
| `/model`               | model and reasoning effort                                                                            |
| `/agents`              | the agents this team runs on: choose one, add a Nuphos-managed or self-hosted one, `l` to sign one in |
| `/team`                | switch team                                                                                           |
| `/new`, `/resume`      | start or continue a conversation                                                                      |
| `/archive`             | archive this conversation, start a new one                                                            |
| `/logout`, `/quit`     | sign out, exit                                                                                        |

The wheel scrolls through the terminal's alternate scroll mode, so the mouse is
left alone and selecting text to copy works as usual. Scrolled up, the view
stays put while a reply streams in below it.

Before the first message, `/model` picks from the agent's own models; the first
message carries the pick, as the desktop's new-conversation picker does.

## Releasing

Bump `version` in `Cargo.toml`, merge, then push a matching tag on main:

```sh
git tag cli-v0.2.0 && git push origin cli-v0.2.0
```

`.github/workflows/release-cli.yml` builds the four binaries, and the
`nuphos agent` runtime for each platform, and publishes them as the
`CLI v0.2.0` GitHub Release, which the installer and `nuphos update` pick up.

To try `nuphos agent` from a checkout, stage the runtime and point at it:

```sh
cd apps/desktop && node local-runtime/prepare.mjs --targets linux-x64 --require
bun build electron/main/local-runtime/cli-host.ts --target=node --format=esm \
  --outfile build/local-runtime/linux-x64/host.mjs
NUPHOS_LOCAL_RUNTIME_DIR=$PWD/build/local-runtime/linux-x64 nuphos agent
```

## Development

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
