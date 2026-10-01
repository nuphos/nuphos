// Command nuphos-relay-agent runs as a single small pod inside a customer's
// private Kubernetes cluster and does exactly one thing: give Nuphos a way in
// when nothing can be dialled from the outside.
//
// It only ever makes OUTBOUND connections (TLS/443 to the Nuphos relay, through
// HTTPS_PROXY if the cluster has one), exposes no port, needs no Service, and
// runs unprivileged. It holds a small pool of idle connections; the relay picks
// one when it needs a stream, names a host:port, and the agent dials it inside
// the cluster and copies bytes.
//
// It has no allow-list, no audit log, and no opinion about the destination on
// purpose. Everything the customer needs to bound and observe this belongs to
// primitives they already own and can read with kubectl: an egress
// NetworkPolicy on this pod, and RBAC on the ServiceAccount its kubeconfig
// credential belongs to. A policy engine of ours here would only add something
// they would have to take on trust.
package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"
)

type settings struct {
	endpoint  string
	token     string
	poolSize  int
	idleAfter time.Duration
	insecure  bool
	// Local development against a plaintext relay. Never set in a cluster: the
	// token would cross the wire in the clear.
	plaintext bool
}

// Reported to the relay at handshake so an operator can see which build a
// cluster is running without shelling into it. Bump it when the agent changes in
// a way an operator would want to chase.
const agentVersion = "1"

const (
	relayDialTimeout    = 15 * time.Second
	targetDialTimeout   = 10 * time.Second
	handshakeTimeout    = 15 * time.Second
	reconnectBackoffMin = time.Second
	reconnectBackoffMax = 30 * time.Second
)

func loadSettings() (settings, error) {
	loaded := settings{
		endpoint:  os.Getenv("NUPHOS_RELAY_ENDPOINT"),
		token:     os.Getenv("NUPHOS_RELAY_TOKEN"),
		poolSize:  4,
		idleAfter: 90 * time.Second,
		insecure:  os.Getenv("NUPHOS_RELAY_INSECURE") == "1",
		plaintext: os.Getenv("NUPHOS_RELAY_DEV_PLAINTEXT") == "1",
	}
	if loaded.endpoint == "" {
		return settings{}, errors.New("NUPHOS_RELAY_ENDPOINT is required (host:port)")
	}
	if _, _, err := net.SplitHostPort(loaded.endpoint); err != nil {
		return settings{}, errors.New("NUPHOS_RELAY_ENDPOINT must be host:port")
	}
	if loaded.token == "" {
		return settings{}, errors.New("NUPHOS_RELAY_TOKEN is required")
	}
	if raw := os.Getenv("NUPHOS_RELAY_POOL_SIZE"); raw != "" {
		size, err := strconv.Atoi(raw)
		if err != nil || size < 1 || size > 64 {
			return settings{}, errors.New("NUPHOS_RELAY_POOL_SIZE must be between 1 and 64")
		}
		loaded.poolSize = size
	}
	if raw := os.Getenv("NUPHOS_RELAY_IDLE_TIMEOUT"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed < 10*time.Second || parsed > 10*time.Minute {
			return settings{}, errors.New("NUPHOS_RELAY_IDLE_TIMEOUT must be between 10s and 10m")
		}
		loaded.idleAfter = parsed
	}
	return loaded, nil
}

func main() {
	config, err := loadSettings()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("relay agent starting", "endpoint", config.endpoint, "pool", config.poolSize)
	// Say it out loud. Both of these are development-only, and an operator
	// debugging a connection deserves to see in the logs that this agent is not
	// verifying who it is talking to.
	if config.insecure {
		slog.Warn("TLS verification is DISABLED (NUPHOS_RELAY_INSECURE=1) — development only")
	}
	if config.plaintext {
		slog.Warn("talking to the relay in PLAINTEXT (NUPHOS_RELAY_DEV_PLAINTEXT=1) — the token crosses the wire in the clear")
	}

	var streams sync.WaitGroup
	var slots sync.WaitGroup
	for slot := range config.poolSize {
		slots.Go(func() { holdSlot(ctx, config, slot, &streams) })
	}
	slots.Wait()
	// In-flight streams outlive the pool: a kubectl exec or port-forward should
	// survive SIGTERM long enough for the terminationGracePeriod to matter.
	streams.Wait()
	slog.Info("relay agent stopped")
}

// holdSlot keeps exactly one idle connection parked at the relay. As soon as
// that connection is handed a stream it stops being idle, so the slot dials a
// replacement immediately and the pool stays at full width.
func holdSlot(ctx context.Context, config settings, slot int, streams *sync.WaitGroup) {
	backoff := reconnectBackoffMin
	// Stagger the initial dials so a restart does not open the whole pool in the
	// same millisecond.
	if !sleepContext(ctx, time.Duration(slot)*250*time.Millisecond) {
		return
	}
	for ctx.Err() == nil {
		err := parkOnce(ctx, config, streams)
		switch {
		case err == nil:
			backoff = reconnectBackoffMin
			continue
		case ctx.Err() != nil:
			return
		default:
			slog.Warn("relay connection lost", "slot", slot, "error", err, "retry_in", backoff)
			if !sleepContext(ctx, jitter(backoff)) {
				return
			}
			backoff = min(backoff*2, reconnectBackoffMax)
		}
	}
}

// parkOnce dials the relay, authenticates, and waits. It returns nil once the
// connection has been handed off to a stream (the caller should re-dial at
// once), and an error if the connection died before that.
func parkOnce(ctx context.Context, config settings, streams *sync.WaitGroup) error {
	conn, err := dialRelay(ctx, config)
	if err != nil {
		return err
	}
	handedOff := false
	defer func() {
		if !handedOff {
			_ = conn.Close()
		}
	}()

	if err := conn.SetDeadline(time.Now().Add(handshakeTimeout)); err != nil {
		return err
	}
	if err := writeLine(conn, "%s AGENT %s %s", protocolVersion, config.token, agentVersion); err != nil {
		return fmt.Errorf("send hello: %w", err)
	}
	reader := bufio.NewReaderSize(conn, maxLineBytes)
	if line, err := readLine(reader); err != nil {
		return fmt.Errorf("await ready: %w", err)
	} else if line != "READY" {
		return fmt.Errorf("relay rejected the agent: %q", line)
	}

	for {
		// The relay PINGs well inside this window, so a silent connection — a
		// dropped NAT mapping, a proxy that forgot us — is caught here instead of
		// sitting in the pool looking healthy.
		if err := conn.SetDeadline(time.Now().Add(config.idleAfter)); err != nil {
			return err
		}
		line, err := readLine(reader)
		if err != nil {
			return err
		}
		switch line {
		case "PING":
			if err := writeLine(conn, "PONG"); err != nil {
				return err
			}
		case "":
			continue
		default:
			target, ok := parseOpen(line)
			if !ok {
				return fmt.Errorf("unexpected command: %q", line)
			}
			handedOff = true
			streams.Go(func() { serveStream(conn, reader, target) })
			return nil
		}
	}
}

// serveStream dials the requested in-cluster address and splices it to the relay
// connection. The relay is trusted to have authorised the caller; the only thing
// decided here is whether the dial succeeds.
func serveStream(conn net.Conn, buffered *bufio.Reader, target string) {
	defer func() { _ = conn.Close() }()

	if err := conn.SetDeadline(time.Time{}); err != nil {
		slog.Warn("clear stream deadline failed", "target", target, "error", err)
		return
	}
	upstream, err := net.DialTimeout("tcp", target, targetDialTimeout)
	if err != nil {
		slog.Warn("in-cluster dial failed", "target", target, "error", err)
		_ = writeLine(conn, "ERR %s", dialErrorReason(err))
		return
	}
	defer func() { _ = upstream.Close() }()
	if err := writeLine(conn, "OK"); err != nil {
		return
	}
	slog.Info("stream open", "target", target)

	var wait sync.WaitGroup
	// buffered, not conn: the reader may already hold bytes the peer pipelined
	// behind the OPEN line, and reading conn directly would drop them.
	wait.Go(func() { copyThenCloseWrite(upstream, buffered) })
	wait.Go(func() { copyThenCloseWrite(conn, upstream) })
	wait.Wait()
	slog.Info("stream closed", "target", target)
}

type writeCloser interface{ CloseWrite() error }

// copyThenCloseWrite propagates EOF as a half-close so a protocol that ends by
// shutting down one direction (kubectl exec's stdin, an HTTP/1 upload) does not
// hang waiting for the other end to notice.
func copyThenCloseWrite(dst io.Writer, src io.Reader) {
	_, _ = io.Copy(dst, src)
	if half, ok := dst.(writeCloser); ok {
		_ = half.CloseWrite()
		return
	}
	if closer, ok := dst.(io.Closer); ok {
		_ = closer.Close()
	}
}

func dialErrorReason(err error) string {
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return "timeout"
	}
	return "unreachable"
}

// dialRelay honours HTTPS_PROXY/https_proxy: on-prem clusters routinely allow
// egress only through one, and a tunnel it refuses to open is the most likely
// way this agent fails at a new customer.
func dialRelay(ctx context.Context, config settings) (net.Conn, error) {
	host, _, err := net.SplitHostPort(config.endpoint)
	if err != nil {
		return nil, err
	}
	dialCtx, cancel := context.WithTimeout(ctx, relayDialTimeout)
	defer cancel()

	raw, err := dialMaybeProxied(dialCtx, config.endpoint)
	if err != nil {
		return nil, err
	}
	if config.plaintext {
		return raw, nil
	}
	conn := tls.Client(raw, &tls.Config{
		ServerName:         host,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: config.insecure,
	})
	if err := conn.HandshakeContext(dialCtx); err != nil {
		_ = raw.Close()
		return nil, fmt.Errorf("tls handshake: %w", err)
	}
	return conn, nil
}

func dialMaybeProxied(ctx context.Context, endpoint string) (net.Conn, error) {
	dialer := &net.Dialer{}
	proxy, err := proxyForEndpoint(endpoint)
	if err != nil || proxy == nil {
		if err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, "tcp", endpoint)
	}
	conn, err := dialer.DialContext(ctx, "tcp", proxyAddress(proxy))
	if err != nil {
		return nil, fmt.Errorf("dial proxy %s: %w", proxy.Host, err)
	}
	if err := proxyConnect(ctx, conn, proxy, endpoint); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

// proxyForEndpoint asks the standard library which proxy (if any) applies, so
// HTTPS_PROXY and NO_PROXY behave exactly as they do for every other tool in
// the cluster.
func proxyForEndpoint(endpoint string) (*url.URL, error) {
	return http.ProxyFromEnvironment(&http.Request{URL: &url.URL{Scheme: "https", Host: endpoint}})
}

func proxyAddress(proxy *url.URL) string {
	if proxy.Port() != "" {
		return proxy.Host
	}
	if proxy.Scheme == "https" {
		return net.JoinHostPort(proxy.Host, "443")
	}
	return net.JoinHostPort(proxy.Host, "80")
}

func proxyConnect(ctx context.Context, conn net.Conn, proxy *url.URL, endpoint string) error {
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			return err
		}
		defer func() { _ = conn.SetDeadline(time.Time{}) }()
	}
	request := &http.Request{
		Method: http.MethodConnect,
		URL:    &url.URL{Opaque: endpoint},
		Host:   endpoint,
		Header: http.Header{},
	}
	if user := proxy.User; user != nil {
		password, _ := user.Password()
		request.Header.Set("Proxy-Authorization", "Basic "+basicAuth(user.Username(), password))
	}
	if err := request.Write(conn); err != nil {
		return fmt.Errorf("write CONNECT: %w", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), request)
	if err != nil {
		return fmt.Errorf("read CONNECT response: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("proxy refused CONNECT to %s: %s", endpoint, response.Status)
	}
	return nil
}

func basicAuth(username, password string) string {
	return base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
}

func sleepContext(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

func jitter(base time.Duration) time.Duration {
	return base/2 + time.Duration(rand.Int64N(int64(base)))
}
