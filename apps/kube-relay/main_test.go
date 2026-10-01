package main

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testSecret = "0123456789abcdef0123456789abcdef"

func TestVerifyToken(t *testing.T) {
	secret := []byte(testSecret)
	now := time.Unix(1_700_000_000, 0)

	token, err := signToken(secret, tokenClaims{
		Cluster: "cluster-key",
		Purpose: purposeSession,
		Session: "session-1",
		Expires: now.Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}

	claims, err := verifyTokenFor(secret, token, purposeSession, now)
	if err != nil {
		t.Fatalf("expected the token to verify, got %v", err)
	}
	if claims.Cluster != "cluster-key" || claims.Session != "session-1" {
		t.Fatalf("unexpected claims %+v", claims)
	}

	if _, err := verifyTokenFor(secret, token, purposeAgent, now); err == nil {
		t.Fatal("expected a session token to be refused where an agent token is required")
	}
	if _, err := verifyToken(secret, token, now.Add(2*time.Hour)); err == nil {
		t.Fatal("expected an expired token to be refused")
	}
	if _, err := verifyToken([]byte(strings.Repeat("x", 32)), token, now); err == nil {
		t.Fatal("expected a token signed with another secret to be refused")
	}
	// Flipping a payload byte must fail on the signature, not on the JSON.
	tampered := strings.Replace(token, "nr1_", "nr1_A", 1)
	if _, err := verifyToken(secret, tampered, now); err == nil {
		t.Fatal("expected a tampered token to be refused")
	}
}

func TestTokenWithoutExpiryIsRefused(t *testing.T) {
	secret := []byte(testSecret)
	token, err := signToken(secret, tokenClaims{Cluster: "cluster-key", Purpose: purposeAgent})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyToken(secret, token, time.Unix(1_700_000_000, 0)); err == nil {
		t.Fatal("expected a token with no expiry to be refused")
	}
}

// The whole path: an agent parks, a sandbox CONNECTs through the proxy, and
// bytes reach a service only the agent can dial.
func TestProxyReachesTargetThroughParkedAgent(t *testing.T) {
	harness := startRelay(t)
	echo := listenEcho(t)
	harness.parkAgent(t, "cluster-key")

	client := harness.connect(t, harness.sessionToken(t, "cluster-key", "session-1"), echo.Addr().String())
	defer func() { _ = client.conn.Close() }()

	if _, err := client.conn.Write([]byte("hello-cluster")); err != nil {
		t.Fatal(err)
	}
	if err := client.conn.(*net.TCPConn).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	echoed, err := io.ReadAll(client.reader)
	if err != nil {
		t.Fatalf("read echo: %v", err)
	}
	if string(echoed) != "hello-cluster" {
		t.Fatalf("unexpected echo %q", echoed)
	}
}

func TestProxyRejectsUnauthorizedSession(t *testing.T) {
	harness := startRelay(t)
	harness.parkAgent(t, "cluster-key")

	// Signed for a different cluster than the parked agent: the signature is
	// valid, the authorisation is not.
	// Waits out agentWaitTimeout first — a cluster that never had an agent is the
	// slow path, not the common one.
	other := harness.sessionToken(t, "another-cluster", "session-1")
	if status := harness.connectStatus(t, other, "10.0.0.1:6443"); status != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for a cluster with no agent, got %d", status)
	}
	if status := harness.connectStatus(t, "nr1_not-a-token", "10.0.0.1:6443"); status != http.StatusProxyAuthRequired {
		t.Fatalf("expected 407 for a bad token, got %d", status)
	}
	agentToken := harness.token(t, tokenClaims{
		Cluster: "cluster-key", Purpose: purposeAgent, Expires: time.Now().Add(time.Hour).Unix(),
	})
	if status := harness.connectStatus(t, agentToken, "10.0.0.1:6443"); status != http.StatusProxyAuthRequired {
		t.Fatalf("expected 407 when an agent token is used as a session token, got %d", status)
	}
}

// A relay restart, or a rolling update of the customer's Deployment, leaves a
// brief window with nothing parked. The request should ride it out instead of
// failing in a way that reads as "the customer's cluster is down".
func TestProxyWaitsForAnAgentToReconnect(t *testing.T) {
	harness := startRelay(t)
	echo := listenEcho(t)

	// Park only after the CONNECT is already in flight.
	go func() {
		time.Sleep(300 * time.Millisecond)
		harness.parkAgent(t, "cluster-key")
	}()

	client := harness.connect(t, harness.sessionToken(t, "cluster-key", "session-1"), echo.Addr().String())
	defer func() { _ = client.conn.Close() }()
	if _, err := client.conn.Write([]byte("after-reconnect")); err != nil {
		t.Fatal(err)
	}
	if err := client.conn.(*net.TCPConn).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	echoed, err := io.ReadAll(client.reader)
	if err != nil {
		t.Fatalf("read echo: %v", err)
	}
	if string(echoed) != "after-reconnect" {
		t.Fatalf("unexpected echo %q", echoed)
	}
}

func TestProxyReportsUnreachableTarget(t *testing.T) {
	harness := startRelay(t)
	harness.parkAgent(t, "cluster-key")

	// Port 1 on the agent's own host: reachable stack, refused connection.
	status := harness.connectStatus(t, harness.sessionToken(t, "cluster-key", "session-1"), "127.0.0.1:1")
	if status != http.StatusBadGateway {
		t.Fatalf("expected 502 when the agent cannot dial the target, got %d", status)
	}
}

func TestProxyRefusesNonConnect(t *testing.T) {
	harness := startRelay(t)
	response, err := http.Get("http://" + harness.proxyAddr + "/anything")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", response.StatusCode)
	}
}

func TestAgentWithBadTokenIsRefused(t *testing.T) {
	harness := startRelay(t)
	conn, err := net.Dial("tcp", harness.agentAddr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	if err := writeLine(conn, "%s AGENT nr1_bogus", protocolVersion); err != nil {
		t.Fatal(err)
	}
	line, err := readLine(bufio.NewReaderSize(conn, maxLineBytes))
	if err != nil {
		t.Fatal(err)
	}
	if line != "ERR unauthorized" {
		t.Fatalf("unexpected reply %q", line)
	}
	if counts := harness.service.pool.idleCounts(); len(counts) != 0 {
		t.Fatalf("a refused agent must not be parked, got %v", counts)
	}
}

// "Enrolled" and "connected" are different answers, and after a pool drains so
// is "was here a moment ago". /status has to keep them apart.
func TestStatusReportsPresenceAfterThePoolDrains(t *testing.T) {
	harness := startRelay(t)
	echo := listenEcho(t)
	harness.parkAgent(t, "cluster-key")

	before := harness.service.pool.clusters()["cluster-key"]
	if before.Idle != 1 || before.LastSeenAt == "" {
		t.Fatalf("expected a parked agent to be visible, got %+v", before)
	}
	if before.AgentVersion != "test-agent" {
		t.Fatalf("expected the agent version to be reported, got %q", before.AgentVersion)
	}

	// Claim the only connection: the pool is empty, but the cluster is not gone.
	client := harness.connect(t, harness.sessionToken(t, "cluster-key", "session-1"), echo.Addr().String())
	defer func() { _ = client.conn.Close() }()

	after := harness.service.pool.clusters()["cluster-key"]
	if after.Idle != 0 {
		t.Fatalf("expected no idle connections left, got %d", after.Idle)
	}
	if after.LastSeenAt != before.LastSeenAt {
		t.Fatalf("last seen should survive the pool draining, got %q", after.LastSeenAt)
	}
}

func TestStatusAcceptsOnlyTheDerivedCredential(t *testing.T) {
	harness := startRelay(t)

	// The signing secret itself must NOT open /status: the listener is plain
	// HTTP, so a captured header would otherwise be the key to every cluster's
	// tokens rather than a read-only status credential.
	if status := harness.statusWith(t, testSecret); status != http.StatusUnauthorized {
		t.Fatalf("expected the raw signing secret to be refused, got %d", status)
	}
	if status := harness.statusWith(t, statusCredential([]byte(testSecret))); status != http.StatusOK {
		t.Fatalf("expected the derived credential to be accepted, got %d", status)
	}
}

func TestStatusRequiresAuthorization(t *testing.T) {
	harness := startRelay(t)
	request, err := http.NewRequest(http.MethodGet, "http://"+harness.healthAddr+"/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a bearer token, got %d", response.StatusCode)
	}
}

func TestStatusIsAvailableOnThePublicProxyListener(t *testing.T) {
	harness := startRelay(t)
	if status := harness.statusAt(t, harness.proxyAddr, ""); status != http.StatusUnauthorized {
		t.Fatalf("expected 401 from public status without the derived credential, got %d", status)
	}
	if status := harness.statusAt(t, harness.proxyAddr, statusCredential(harness.service.secret)); status != http.StatusOK {
		t.Fatalf("expected 200 from the public status endpoint, got %d", status)
	}
}

type harness struct {
	service    *relay
	agentAddr  string
	proxyAddr  string
	healthAddr string
}

func startRelay(t *testing.T) *harness {
	t.Helper()
	service := &relay{
		secret: []byte(testSecret),
		// Ping often enough that a keepalive definitely interleaves with the
		// claims in these tests.
		pool: newPool(50*time.Millisecond, 2*time.Second, 5*time.Second),
	}

	agentListener := listenLocal(t)
	proxyListener := listenLocal(t)
	healthListener := listenLocal(t)

	proxyServer := &http.Server{Handler: service.publicRoutes()}
	healthServer := &http.Server{Handler: service.healthRoutes()}
	go func() { _ = proxyServer.Serve(proxyListener) }()
	go func() { _ = healthServer.Serve(healthListener) }()
	go service.acceptAgents(agentListener)
	t.Cleanup(func() {
		_ = proxyServer.Close()
		_ = healthServer.Close()
	})

	return &harness{
		service:    service,
		agentAddr:  agentListener.Addr().String(),
		proxyAddr:  proxyListener.Addr().String(),
		healthAddr: healthListener.Addr().String(),
	}
}

func (h *harness) statusWith(t *testing.T, credential string) int {
	t.Helper()
	return h.statusAt(t, h.healthAddr, credential)
}

func (h *harness) statusAt(t *testing.T, address, credential string) int {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, "http://"+address+"/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+credential)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	return response.StatusCode
}

func (h *harness) token(t *testing.T, claims tokenClaims) string {
	t.Helper()
	token, err := signToken(h.service.secret, claims)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func (h *harness) sessionToken(t *testing.T, cluster, session string) string {
	t.Helper()
	return h.token(t, tokenClaims{
		Cluster: cluster, Purpose: purposeSession, Session: session,
		Expires: time.Now().Add(time.Hour).Unix(),
	})
}

// parkAgent stands in for apps/kube-relay-agent: park one connection, and when
// the relay asks, dial the named address and splice.
func (h *harness) parkAgent(t *testing.T, cluster string) {
	t.Helper()
	conn, err := net.Dial("tcp", h.agentAddr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	token := h.token(t, tokenClaims{
		Cluster: cluster, Purpose: purposeAgent, Expires: time.Now().Add(time.Hour).Unix(),
	})
	if err := writeLine(conn, "%s AGENT %s test-agent", protocolVersion, token); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReaderSize(conn, maxLineBytes)
	if line, err := readLine(reader); err != nil || line != "READY" {
		t.Fatalf("expected READY, got %q (%v)", line, err)
	}

	go func() {
		for {
			line, err := readLine(reader)
			if err != nil {
				return
			}
			if line == "PING" {
				if err := writeLine(conn, "PONG"); err != nil {
					return
				}
				continue
			}
			target := strings.TrimPrefix(line, "OPEN ")
			upstream, err := net.DialTimeout("tcp", target, 2*time.Second)
			if err != nil {
				_ = writeLine(conn, "ERR unreachable")
				return
			}
			if err := writeLine(conn, "OK"); err != nil {
				return
			}
			// Half-close, like the real agent: without it the echo server never
			// sees EOF and the caller waits for a reply that cannot come.
			go func() {
				_, _ = io.Copy(upstream, reader)
				if tcp, ok := upstream.(*net.TCPConn); ok {
					_ = tcp.CloseWrite()
				}
			}()
			_, _ = io.Copy(conn, upstream)
			_ = upstream.Close()
			// The real agent closes the relay connection when the stream ends; the
			// relay only learns the stream is over from that close.
			_ = conn.Close()
			return
		}
	}()

	waitForIdle(t, h.service.pool, cluster, 1)
}

type proxyStream struct {
	conn   net.Conn
	reader *bufio.Reader
}

func (h *harness) connect(t *testing.T, token, target string) proxyStream {
	t.Helper()
	stream, status := h.connectRaw(t, token, target)
	if status != http.StatusOK {
		t.Fatalf("expected the tunnel to open, got status %d", status)
	}
	return stream
}

func (h *harness) connectStatus(t *testing.T, token, target string) int {
	t.Helper()
	stream, status := h.connectRaw(t, token, target)
	if stream.conn != nil {
		_ = stream.conn.Close()
	}
	return status
}

func (h *harness) connectRaw(t *testing.T, token, target string) (proxyStream, int) {
	t.Helper()
	conn, err := net.Dial("tcp", h.proxyAddr)
	if err != nil {
		t.Fatal(err)
	}
	credential := base64.StdEncoding.EncodeToString([]byte(token + ":x"))
	request := fmt.Sprintf(
		"CONNECT %s HTTP/1.1\r\nHost: %s\r\nProxy-Authorization: Basic %s\r\n\r\n",
		target, target, credential,
	)
	if _, err := io.WriteString(conn, request); err != nil {
		t.Fatal(err)
	}
	// Comfortably past agentWaitTimeout: a 503 only comes back after the relay has
	// waited that long for an agent to show up.
	if err := conn.SetReadDeadline(time.Now().Add(agentWaitTimeout + 5*time.Second)); err != nil {
		t.Fatal(err)
	}
	// Parsed by hand rather than with http.ReadResponse: without the originating
	// request, net/http treats a tunnel response as having an unbounded body and
	// its reader then swallows the first bytes of the stream itself.
	reader := bufio.NewReader(conn)
	status, err := readTunnelResponse(reader)
	if err != nil {
		t.Fatalf("read CONNECT response: %v", err)
	}
	if err := conn.SetReadDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	}
	return proxyStream{conn: conn, reader: reader}, status
}

func readTunnelResponse(reader *bufio.Reader) (int, error) {
	statusLine, err := reader.ReadString('\n')
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(statusLine)
	if len(fields) < 2 {
		return 0, fmt.Errorf("malformed status line %q", statusLine)
	}
	status, err := strconv.Atoi(fields[1])
	if err != nil {
		return 0, fmt.Errorf("malformed status %q", fields[1])
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return 0, err
		}
		if strings.TrimRight(line, "\r\n") == "" {
			return status, nil
		}
	}
}

func waitForIdle(t *testing.T, p *pool, cluster string, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if p.idleCounts()[cluster] == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("cluster %q never reached %d idle connections (have %v)", cluster, want, p.idleCounts())
}

func listenLocal(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

func listenEcho(t *testing.T) net.Listener {
	t.Helper()
	listener := listenLocal(t)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer func() { _ = conn.Close() }()
				_, _ = io.Copy(conn, conn)
			}()
		}
	}()
	return listener
}
