# syntax=docker/dockerfile:1.7

# Image for the Nuphos **relay agent** pod (apps/kube-relay-agent): the
# outbound-only jump box a customer runs in a private cluster we cannot dial.
#
# Like apps/node-shell, this image runs on CUSTOMERS' clusters, which hold no
# Zeabur registry credentials — so it is published to ECR *Public* and consumed
# by an immutable @sha256 digest. See README.md.
#
# The binary is stdlib-only Go, so the runtime layer is `scratch` plus CA roots:
# nothing to patch, nothing to exec into, and a customer auditing what we asked
# them to run has one static binary to look at. Build multi-arch
# (linux/amd64,linux/arm64) — cluster architecture varies.
FROM golang:1.25-alpine AS build
WORKDIR /src
# No third-party dependencies by design: there is no `go mod download` step and
# no go.sum, so the build cannot pull anything from the network.
COPY go.mod ./
COPY *.go ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/nuphos-relay-agent .

FROM alpine:3.22 AS certs
RUN apk add --no-cache ca-certificates

FROM scratch
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/nuphos-relay-agent /nuphos-relay-agent
# Numeric so it needs no /etc/passwd entry, and matches the runAsUser the
# deployment manifest pins.
USER 65532:65532
ENTRYPOINT ["/nuphos-relay-agent"]
