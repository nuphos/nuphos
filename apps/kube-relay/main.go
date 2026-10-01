// Command nuphos-kube-relay is the Nuphos side of the on-prem cluster tunnel.
//
// It serves two listeners and joins them:
//
//   - agents (TLS): pods running apps/kube-relay-agent inside customers'
//     private clusters park a pool of idle connections here.
//   - proxy (TLS): an HTTP CONNECT proxy for agent sandboxes. A kubeconfig
//     `proxy-url` — or HTTPS_PROXY — pointed at it reaches inside the cluster
//     while the TLS session stays end-to-end with the customer's API server.
//
// This is a separate service rather than routes on the backend for one concrete
// reason: the backend runs several replicas, so an agent's parked connection and
// a sandbox's CONNECT would land on different processes, and only the process
// holding the socket can forward it. A dedicated single-process service (like
// apps/tailscale-dialer) is also what a `proxy-url`, which cannot carry a path,
// needs — its own host:port.
//
// Authorisation is entirely in the tokens (token.go): HMAC-signed by the
// backend, so the relay needs no database, no callback, and holds no secret
// belonging to any customer.
package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

type settings struct {
	tokenSecret []byte
	agentAddr   string
	proxyAddr   string
	healthAddr  string
	tlsCertPath string
	tlsKeyPath  string
	// Local development only: serve both listeners without TLS so a test agent
	// can connect without a certificate.
	plaintext bool
}

const (
	agentHandshakeTimeout = 15 * time.Second
	pingInterval          = 30 * time.Second
	pingTimeout           = 10 * time.Second
	openTimeout           = 20 * time.Second
	// A parked connection must outlive several ping intervals; the agent's own
	// idle timeout (90s) is the other half of this contract.
	minTokenSecretBytes = 32
)

func loadSettings() (settings, error) {
	loaded := settings{
		tokenSecret: []byte(os.Getenv("NUPHOS_RELAY_TOKEN_SECRET")),
		agentAddr:   envOr("NUPHOS_RELAY_AGENT_ADDR", ":8444"),
		proxyAddr:   envOr("NUPHOS_RELAY_PROXY_ADDR", ":8443"),
		healthAddr:  envOr("NUPHOS_RELAY_HEALTH_ADDR", ":8080"),
		tlsCertPath: os.Getenv("NUPHOS_RELAY_TLS_CERT"),
		tlsKeyPath:  os.Getenv("NUPHOS_RELAY_TLS_KEY"),
		plaintext:   os.Getenv("NUPHOS_RELAY_DEV_PLAINTEXT") == "1",
	}
	if len(loaded.tokenSecret) < minTokenSecretBytes {
		return settings{}, fmt.Errorf("NUPHOS_RELAY_TOKEN_SECRET must be at least %d bytes", minTokenSecretBytes)
	}
	if loaded.plaintext {
		return loaded, nil
	}
	if loaded.tlsCertPath == "" || loaded.tlsKeyPath == "" {
		return settings{}, errors.New("NUPHOS_RELAY_TLS_CERT and NUPHOS_RELAY_TLS_KEY are required")
	}
	return loaded, nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

type relay struct {
	secret  []byte
	pool    *pool
	streams sync.WaitGroup
}

func main() {
	config, err := loadSettings()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	service := &relay{secret: config.tokenSecret, pool: newPool(pingInterval, pingTimeout, openTimeout)}

	agentListener, err := service.listen(config, config.agentAddr)
	if err != nil {
		slog.Error("cannot serve agents", "address", config.agentAddr, "error", err)
		os.Exit(1)
	}
	proxyListener, err := service.listen(config, config.proxyAddr)
	if err != nil {
		slog.Error("cannot serve the proxy", "address", config.proxyAddr, "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	proxyServer := &http.Server{
		Handler:           service.publicRoutes(),
		ReadHeaderTimeout: 10 * time.Second,
		// Deliberately no Read/WriteTimeout: every request here becomes a
		// hijacked tunnel that legitimately runs for hours (a kubectl watch, a
		// port-forward), and those deadlines would cut it. IdleTimeout still
		// reclaims connections that opened and then said nothing.
		IdleTimeout: 2 * time.Minute,
	}
	healthServer := &http.Server{
		Addr:              config.healthAddr,
		Handler:           service.healthRoutes(),
		ReadHeaderTimeout: 5 * time.Second,
		// Nothing here streams, so this one takes the full set.
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := healthServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("health server stopped", "error", err)
		}
	}()
	go func() {
		if err := proxyServer.Serve(proxyListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("proxy server stopped", "error", err)
		}
	}()
	go service.acceptAgents(agentListener)

	slog.Info("kube relay listening",
		"agents", config.agentAddr, "proxy", config.proxyAddr, "health", config.healthAddr, "tls", !config.plaintext)

	<-ctx.Done()
	slog.Info("shutting down")
	_ = agentListener.Close()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = healthServer.Shutdown(shutdownCtx)
	// Shutdown leaves hijacked connections alone, which is what we want: an
	// in-flight kubectl exec or watch keeps running while the listener stops
	// accepting.
	_ = proxyServer.Shutdown(shutdownCtx)
	service.streams.Wait()
	slog.Info("stopped")
}

func (service *relay) listen(config settings, address string) (net.Listener, error) {
	if config.plaintext {
		return net.Listen("tcp", address)
	}
	certificate, err := tls.LoadX509KeyPair(config.tlsCertPath, config.tlsKeyPath)
	if err != nil {
		return nil, fmt.Errorf("load certificate: %w", err)
	}
	return tls.Listen("tcp", address, &tls.Config{
		Certificates: []tls.Certificate{certificate},
		MinVersion:   tls.VersionTLS12,
		// HTTP/2 cannot be hijacked, and the proxy listener needs a raw socket to
		// splice. Both listeners are HTTP/1.1-or-nothing.
		NextProtos: []string{"http/1.1"},
	})
}

func (service *relay) acceptAgents(listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			slog.Warn("agent accept failed", "error", err)
			continue
		}
		go service.admitAgent(conn)
	}
}

// admitAgent authenticates a newly connected agent and parks it. It blocks for
// as long as the connection stays idle, so it runs on its own goroutine.
func (service *relay) admitAgent(conn net.Conn) {
	if err := conn.SetDeadline(time.Now().Add(agentHandshakeTimeout)); err != nil {
		_ = conn.Close()
		return
	}
	reader := newLineReader(conn)
	line, err := readLine(reader)
	if err != nil {
		_ = conn.Close()
		return
	}
	token, agentVersion, err := parseAgentHello(line)
	if err != nil {
		_ = writeLine(conn, "ERR bad handshake")
		_ = conn.Close()
		return
	}
	claims, err := verifyTokenFor(service.secret, token, purposeAgent, time.Now())
	if err != nil {
		slog.Warn("agent rejected", "remote", remoteHost(conn), "error", err)
		// Deliberately vague: the agent's own logs need to say "we were refused",
		// and nothing more precise helps anyone who is guessing tokens.
		_ = writeLine(conn, "ERR unauthorized")
		_ = conn.Close()
		return
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		return
	}
	if err := writeLine(conn, "READY"); err != nil {
		_ = conn.Close()
		return
	}
	slog.Info("agent connection parked",
		"cluster", claims.Cluster, "remote", remoteHost(conn), "agent_version", agentVersion)
	service.pool.park(claims.Cluster, conn, reader, agentVersion)
}

func (service *relay) handleProxy(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodConnect {
		http.Error(writer, "this proxy only serves CONNECT", http.StatusMethodNotAllowed)
		return
	}
	claims, err := service.authorizeProxy(request)
	if err != nil {
		writer.Header().Set("Proxy-Authenticate", `Basic realm="nuphos-relay"`)
		http.Error(writer, "proxy authentication required", http.StatusProxyAuthRequired)
		return
	}
	target := request.Host
	if target == "" {
		target = request.URL.Host
	}
	if _, _, err := net.SplitHostPort(target); err != nil {
		http.Error(writer, "CONNECT target must be host:port", http.StatusBadRequest)
		return
	}

	opened, err := service.pool.open(claims.Cluster, target)
	if errors.Is(err, errNoAgent) {
		slog.Warn("no agent parked", "cluster", claims.Cluster, "session", claims.Session, "target", target)
		http.Error(writer, "the cluster's relay agent is not connected", http.StatusServiceUnavailable)
		return
	}
	if err == nil {
		err = opened.err
	}
	if err != nil {
		slog.Warn("stream refused", "cluster", claims.Cluster, "session", claims.Session, "target", target, "error", err)
		http.Error(writer, "could not reach the target inside the cluster", http.StatusBadGateway)
		return
	}

	client, buffered, hijackErr := hijack(writer)
	if hijackErr != nil {
		_ = opened.conn.Close()
		slog.Error("cannot hijack the CONNECT connection", "error", hijackErr)
		http.Error(writer, "proxy cannot splice this connection", http.StatusInternalServerError)
		return
	}
	// http.Server set deadlines on this connection before the hijack and they
	// outlive it; a tunnel is long-lived by design, so clear them.
	if err := client.SetDeadline(time.Time{}); err != nil {
		_ = client.Close()
		_ = opened.conn.Close()
		slog.Warn("cannot clear the hijacked connection's deadline", "error", err)
		return
	}
	if _, err := io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		_ = client.Close()
		_ = opened.conn.Close()
		return
	}

	service.streams.Go(func() { splice(claims, target, client, clientReader(client, buffered), opened) })
}

// clientReader keeps any bytes the caller pipelined behind its CONNECT request:
// http.Server may already have read them into the hijacked buffer, and reading
// the socket directly would silently drop the first bytes of the stream.
func clientReader(client net.Conn, buffered *bufio.ReadWriter) io.Reader {
	if buffered == nil || buffered.Reader.Buffered() == 0 {
		return client
	}
	return io.MultiReader(io.LimitReader(buffered.Reader, int64(buffered.Reader.Buffered())), client)
}

func splice(claims tokenClaims, target string, client net.Conn, fromClient io.Reader, opened claimResult) {
	defer func() { _ = client.Close() }()
	defer func() { _ = opened.conn.Close() }()

	startedAt := time.Now()
	var toCluster, fromCluster int64
	var wait sync.WaitGroup
	wait.Go(func() { toCluster = copyThenCloseWrite(opened.conn, fromClient) })
	// opened.reader, not opened.conn: it may hold bytes the agent pipelined
	// behind its OK line.
	wait.Go(func() { fromCluster = copyThenCloseWrite(client, opened.reader) })
	wait.Wait()

	// One line per stream: who reached what, for how long, and how much moved.
	// This is the audit trail on our side; the customer's is their own pod logs
	// and NetworkPolicy.
	slog.Info("stream finished",
		"cluster", claims.Cluster,
		"session", claims.Session,
		"target", target,
		"sent_bytes", toCluster,
		"received_bytes", fromCluster,
		"duration_ms", time.Since(startedAt).Milliseconds())
}

type writeCloser interface{ CloseWrite() error }

func copyThenCloseWrite(dst io.Writer, src io.Reader) int64 {
	copied, _ := io.Copy(dst, src)
	if half, ok := dst.(writeCloser); ok {
		_ = half.CloseWrite()
		return copied
	}
	if closer, ok := dst.(io.Closer); ok {
		_ = closer.Close()
	}
	return copied
}

// authorizeProxy accepts the session token as the Basic username, which is how
// Go's HTTP transport sends a `proxy-url`'s userinfo — so a kubeconfig entry of
// `proxy-url: https://<token>:x@relay.nuphos.ai:8443` authenticates with no
// client-side glue at all.
func (service *relay) authorizeProxy(request *http.Request) (tokenClaims, error) {
	header := request.Header.Get("Proxy-Authorization")
	encoded, found := strings.CutPrefix(header, "Basic ")
	if !found {
		return tokenClaims{}, errors.New("missing proxy credentials")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return tokenClaims{}, errors.New("malformed proxy credentials")
	}
	token, _, _ := strings.Cut(string(decoded), ":")
	if token == "" {
		return tokenClaims{}, errors.New("empty proxy credentials")
	}
	return verifyTokenFor(service.secret, token, purposeSession, time.Now())
}

func (service *relay) healthRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.Handle("GET /status", service.statusHandler())
	return mux
}

// publicRoutes keeps the CONNECT proxy and the authenticated status endpoint on
// one TLS listener. That makes status reachable by backend replicas in either
// production cluster without exposing the relay's plain-text health port.
func (service *relay) publicRoutes() http.Handler {
	status := service.statusHandler()
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/status" {
			status.ServeHTTP(writer, request)
			return
		}
		// Do not route CONNECT through ServeMux: authority-form requests have an
		// empty path and ServeMux canonicalises that to "/" with a 301 response.
		service.handleProxy(writer, request)
	})
}

func (service *relay) statusHandler() http.Handler {
	// Cluster keys are opaque random ids, so idle counts carry nothing sensitive.
	// Still authenticated, because "which of our customers has a live tunnel" is
	// not something to publish. The credential is derived from the signing secret
	// rather than being it, so a leaked header cannot mint relay tokens.
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !service.authorizedStatus(request.Header.Get("Authorization")) {
			writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{
			"clusters": service.pool.clusters(),
			// Kept alongside the richer view so an older backend keeps working.
			"idle": service.pool.idleCounts(),
		})
	})
}

func (service *relay) authorizedStatus(header string) bool {
	provided, found := strings.CutPrefix(header, "Bearer ")
	if !found {
		return false
	}
	// A derived credential, not the signing secret — see statusCredential.
	expected := statusCredential(service.secret)
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func newLineReader(conn net.Conn) *bufio.Reader {
	return bufio.NewReaderSize(conn, maxLineBytes)
}

func hijack(writer http.ResponseWriter) (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := writer.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	conn, buffered, err := hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}
	return conn, buffered, nil
}

func remoteHost(conn net.Conn) string {
	host, _, err := net.SplitHostPort(conn.RemoteAddr().String())
	if err != nil {
		return conn.RemoteAddr().String()
	}
	return host
}
