# syntax=docker/dockerfile:1.7

# Minimal image for the Nuphos **node-shell** privileged pod
# (see apps/desktop/electron/pod-exec.ts → startNodeExecSession).
#
# The pod runs privileged with host PID/IPC/net, so this image effectively owns
# the node. It needs only `nsenter` (to enter the host's namespaces) and a way
# to stay alive — the interactive shell itself comes from the *host* via
# nsenter, NOT from this image. Keep it tiny: every extra binary here runs on a
# pod that already has host root.
#
# Built + pushed to a Zeabur-controlled ECR *Public* repo (public.ecr.aws) so it
# is pullable without credentials from users' arbitrary clusters, and referenced
# from the desktop app by an IMMUTABLE @sha256 digest (NUPHOS_NODE_SHELL_IMAGE).
# Build multi-arch (linux/amd64,linux/arm64) since node arch varies — see README.

# TODO(ZEA-9869): pin the base by digest (alpine@sha256:...) once chosen — e.g.
# via Renovate — so the supply chain is immutable end-to-end. The pushed image
# is already digest-pinned where the desktop app consumes it.
FROM alpine:3.21

# `nsenter` ships in util-linux-misc on modern Alpine; `sleep` comes from the
# base busybox. --no-cache keeps the apk index out of the layer. The build-time
# `nsenter --version` is a sanity check that the binary is actually present.
RUN apk add --no-cache util-linux-misc \
    && nsenter --version

# The pod spec overrides this with `sleep <n>` to keep the container alive while
# the app execs `nsenter` in; default to a harmless long sleep so a bare run
# doesn't exit immediately.
CMD ["sleep", "infinity"]
