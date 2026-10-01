FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/nuphos-tailscale-dialer .

FROM alpine:3.22
RUN addgroup -S nuphos && adduser -S -G nuphos nuphos
USER nuphos
COPY --from=build /out/nuphos-tailscale-dialer /usr/local/bin/nuphos-tailscale-dialer
ENTRYPOINT ["/usr/local/bin/nuphos-tailscale-dialer"]
