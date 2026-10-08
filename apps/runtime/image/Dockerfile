# syntax=docker/dockerfile:1.19

# The Nuphos runtime image. BASE_IMAGE is any image built from
# third_party/openab/Dockerfile.unified; only its `openab` binary is used, so the
# agent CLIs that Dockerfile installs globally never reach this image.
# See the repository README for the build.
#
# Runs as uid/gid 1000 (node) with all caps dropped — everything here must be
# usable without root.

# No default: a baked-in default would publish the operator's registry path in
# the image config, and every caller already knows which base it is taking from.
ARG BASE_IMAGE
# Selects the final stage below: claude-code, codex, grok or antigravity.
ARG RUNTIME_PROVIDER=claude-code

FROM ${BASE_IMAGE:?BASE_IMAGE-build-arg-is-required-see-the-README} AS openab

FROM node:22-trixie-slim AS common

ENV DEBIAN_FRONTEND=noninteractive

# Only what the agent loop, the helpers and the skills need on every turn.
# Everything else is in tools/manifest.json and installs on first use.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl procps ripgrep tini bubblewrap socat unzip \
        bash coreutils util-linux acct \
        git openssh-client jq \
        python3 python3-venv \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* \
    && rm /etc/apt/apt.conf.d/docker-clean \
    && ln -s /usr/bin/python3 /usr/local/bin/python

COPY tools/ /opt/nuphos-runtime/tools/
RUN chmod -R a+rX /opt/nuphos-runtime \
 && chmod 755 /opt/nuphos-runtime/tools/nuphos-tools.mjs \
 && ln -s /opt/nuphos-runtime/tools/nuphos-tools.mjs /usr/local/bin/nuphos-tools \
 && nuphos-tools build /usr/local/bin \
 && kubectl version --client && zeabur version

COPY --chmod=755 sync-skills.sh /usr/local/bin/nuphos-sync-skills
COPY --chmod=755 seed-codex-auth.sh /usr/local/bin/nuphos-seed-codex-auth
COPY runtime-defaults.mjs mcp-bridge-config.mjs session-home.mjs acp-shim.mjs /opt/
# Sourced via BASH_ENV, so it is read, never executed.
COPY --chmod=644 runtime-guard.sh /opt/nuphos-runtime/runtime-guard.sh
COPY codex-login.mjs claude-login.mjs mcp-http-bridge.mjs panel-job.mjs /opt/nuphos-runtime/
COPY grok-login.mjs antigravity-login.mjs /opt/nuphos-runtime/
# COPY --chmod also affects newly created destination directories.
# Runtime helpers must be traversable by the non-root init and agent containers.
RUN chmod 755 /opt/nuphos-runtime \
 && chmod 644 /opt/nuphos-runtime/runtime-guard.sh /opt/nuphos-runtime/codex-login.mjs \
      /opt/nuphos-runtime/claude-login.mjs /opt/nuphos-runtime/grok-login.mjs \
      /opt/nuphos-runtime/antigravity-login.mjs \
      /opt/nuphos-runtime/mcp-http-bridge.mjs /opt/nuphos-runtime/panel-job.mjs

FROM common AS claude-code
# Pin the SDK used by the adapter so the model picker lists current models and
# retains the idle wakeup fixes introduced in SDK 0.3.238.
# The committed lockfile is the integrity boundary for this build step.
ARG CLAUDE_AGENT_SDK_VERSION=0.3.293
COPY claude-agent-acp/package.json claude-agent-acp/package-lock.json \
     claude-agent-acp/patch-adapter.mjs claude-agent-acp/session-state.mjs \
     claude-agent-acp/turn-completion.mjs \
     /opt/nuphos-claude-agent-acp/
# The lockfile carries no libc field, so npm installs the musl build of the
# SDK's native CLI beside the glibc one this Debian image runs.
RUN cd /opt/nuphos-claude-agent-acp \
 && npm ci --omit=dev --ignore-scripts --cache /tmp/npm-cache \
 && rm -rf /tmp/npm-cache node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl \
 && test "$(node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version")" = \
      "${CLAUDE_AGENT_SDK_VERSION}" \
 && node patch-adapter.mjs node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js \
 && ln -s "/opt/nuphos-claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk-linux-$(node -p process.arch)/claude" \
      /usr/local/bin/claude \
 && claude --version
ENV PATH="/opt/nuphos-claude-agent-acp/node_modules/.bin:${PATH}" \
    OPENAB_AGENT_COMMAND="claude-agent-acp" \
    OPENAB_AGENT_AUTH_COMMAND="claude auth login" \
    OPENAB_ADAPTER_VERSION="claude-agent-acp@0.74.0"

FROM common AS codex
COPY codex-acp/package.json codex-acp/package-lock.json \
     codex-acp/patch-adapter.mjs codex-acp/session-config.mjs codex-acp/steering.mjs /opt/nuphos-codex-acp/
RUN cd /opt/nuphos-codex-acp \
 && npm ci --omit=dev --ignore-scripts --cache /tmp/npm-cache \
 && rm -rf /tmp/npm-cache \
 && node patch-adapter.mjs node_modules/@agentclientprotocol/codex-acp/dist/index.js
ENV PATH="/opt/nuphos-codex-acp/node_modules/.bin:${PATH}" \
    OPENAB_AGENT_COMMAND="codex-acp" \
    OPENAB_AGENT_AUTH_COMMAND="codex login --device-auth" \
    OPENAB_ADAPTER_VERSION="codex-acp@1.1.4"

# Grok Build and Antigravity speak ACP themselves, so they take no adapter: the shim
# adds the Nuphos layer in front of the agent. Both agents are proprietary and are
# not redistributed in this image; tools/manifest.json installs the pinned build on
# first use, into the home volume.
FROM common AS grok
ENV OPENAB_AGENT_COMMAND="node /opt/acp-shim.mjs grok" \
    OPENAB_AGENT_AUTH_COMMAND="grok login --device-auth" \
    OPENAB_ADAPTER_VERSION="grok@1.0.46" \
    NUPHOS_RUNTIME_PREINSTALL=grok

FROM common AS antigravity
ENV OPENAB_AGENT_COMMAND="node /opt/acp-shim.mjs antigravity" \
    OPENAB_ADAPTER_VERSION="antigravity-acp@1.3.0" \
    NUPHOS_RUNTIME_PREINSTALL=antigravity-acp

FROM ${RUNTIME_PROVIDER}
ARG RUNTIME_PROVIDER

COPY --from=openab /usr/local/bin/openab /usr/local/bin/openab

# The openab commit the binary was built from, reported on ACP initialize.
ARG OPENAB_BUILD_SHA
ENV OPENAB_BUILD_SHA="${OPENAB_BUILD_SHA}" \
    HOME=/home/node

# What a Nuphos-provisioned pod has always set, which a self-hosted container had
# to rediscover by hand. None of them can move into config.toml — openab reads
# them only as environment.
#
# GATEWAY_ALLOWED_USERS is the gateway-wide L3 identity allowlist, not an ACP switch:
# openab defaults it to deny-all, and an ACP prompt arrives as sender `acp_client`, so
# without this entry the runtime accepts a session and then refuses its first prompt.
# An operator who also enables Discord, Slack or LINE must ADD their sender ids here
# rather than drop the line, or those platforms are denied instead.
#
# The runtime console serves `GET /`: a fresh volume opens a setup page, and each
# Nuphos team connects with its own revocable key through a pairing code. The console
# keeps its state beside the tools on the home volume. Override with
# OPENAB_RUNTIME_CONSOLE=false and a password in OPENAB_ACP_AUTH_KEY.
ENV OPENAB_ACP_ENABLED=true \
    OPENAB_ACP_MCP_SERVERS=true \
    OPENAB_ACP_STREAMING=true \
    GATEWAY_ALLOWED_USERS=acp_client \
    OPENAB_RUNTIME_CONSOLE=true \
    OPENAB_RUNTIME_STATE_DIR=/home/node/.nuphos-runtime \
    OPENAB_RUNTIME_CONNECT_URL_TEMPLATE="nuphos://connect-runtime?url={url}&code={code}&exp={exp}"

# What `_openab/runtime/login` runs, and where the credential it produces lands. Empty
# unless the build supplies them, which makes the runtime report "cannot tell" rather
# than "signed out". The caller selects the pair — see the README.
ARG RUNTIME_LOGIN_COMMAND
ARG RUNTIME_AUTH_FILE
ENV OPENAB_RUNTIME_LOGIN_COMMAND="${RUNTIME_LOGIN_COMMAND}" \
    OPENAB_RUNTIME_AUTH_FILE="${RUNTIME_AUTH_FILE}"

# The one-shot commands `_openab/runtime/job` may run, as `name=argv`. The caller only
# names a job; it never supplies argv. `tools` feeds the runtime console's tool list.
# The timeout ceiling matches the backend's dashboard panel execution budget.
ENV OPENAB_RUNTIME_JOBS="panel=node --max-old-space-size=512 /opt/nuphos-runtime/panel-job.mjs;tools=node /opt/nuphos-runtime/tools/nuphos-tools.mjs list --json" \
    OPENAB_RUNTIME_JOB_MAX_TIMEOUT_MS=300000

# The volumes whose usage `_openab/runtime/state` reports to the operator.
ENV OPENAB_RUNTIME_DISK_PATHS=/home/node,/workspace

# Read by openab's `GET /` status page (see zeabur/openab#40): a human-readable
# runtime label and the image's own release version, so a self-hosted operator
# can sanity-check a fresh deploy in a browser with zero auth. The caller
# supplies the label; RUNTIME_VERSION defaults empty for a bare local build.
ARG RUNTIME_LABEL
ARG RUNTIME_VERSION
ENV OPENAB_RUNTIME_LABEL="${RUNTIME_LABEL}" \
    OPENAB_RUNTIME_VERSION="${RUNTIME_VERSION}"

# openab exits when the file its CMD names is missing, so the image carries one
# and a bare `docker run` needs no volume. A mount at /etc/openab/config.toml
# replaces this file; openab reads that single path and merges nothing.
COPY openab-config.claude-code.toml openab-config.codex.toml openab-config.grok.toml \
     openab-config.antigravity.toml /tmp/nuphos-config/
RUN install -d -m 755 /etc/openab \
 && install -m 644 "/tmp/nuphos-config/openab-config.${RUNTIME_PROVIDER}.toml" \
      /etc/openab/config.toml \
 && rm -rf /tmp/nuphos-config

# `node` cannot create a directory at the root, and a self-hosted container has
# nothing mounted here. A volume at this path replaces it.
RUN install -d -o node -g node -m 755 /workspace

COPY --chmod=755 runtime-start.sh /usr/local/bin/nuphos-runtime-start
WORKDIR /home/node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD pgrep -x openab || exit 1
# In the entrypoint so a replaced command still runs it.
ENTRYPOINT ["tini", "--", "/usr/local/bin/nuphos-runtime-start"]
CMD ["openab", "run", "-c", "/etc/openab/config.toml"]

USER node
RUN test -x /opt/nuphos-runtime \
 && test -r /opt/nuphos-runtime/mcp-http-bridge.mjs \
 && test -r /opt/nuphos-runtime/runtime-guard.sh \
 && test -r /opt/nuphos-runtime/codex-login.mjs \
 && test -r /opt/nuphos-runtime/claude-login.mjs \
 && test -r /opt/nuphos-runtime/grok-login.mjs \
 && test -r /opt/nuphos-runtime/antigravity-login.mjs \
 && test -r /opt/nuphos-runtime/panel-job.mjs \
 && test -r /etc/openab/config.toml \
 && test -x /usr/local/bin/nuphos-runtime-start \
 && test -w /workspace \
 && openab --version \
 && command -v "${OPENAB_AGENT_COMMAND%% *}"
