# syntax=docker/dockerfile:1.7

# Nuphos side of the on-prem cluster tunnel (apps/kube-relay). Unlike
# apps/kube-relay-agent, this one runs on our own cluster, so it ships to the
# private registry alongside backend/admin.
FROM golang:1.25-alpine AS build
WORKDIR /src
# Stdlib only: no go.sum, no module download step.
COPY go.mod ./
COPY *.go ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/nuphos-kube-relay .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 nuphos \
    && adduser -S -D -H -u 10001 -G nuphos nuphos
USER 10001:10001
COPY --from=build /out/nuphos-kube-relay /usr/local/bin/nuphos-kube-relay
ENTRYPOINT ["/usr/local/bin/nuphos-kube-relay"]
