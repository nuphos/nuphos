package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"io"
	"math/big"
	"net"
	"sync"
	"testing"
	"time"
)

func TestParseOpen(t *testing.T) {
	for _, line := range []string{
		"OPEN 10.0.0.1:6443",
		"OPEN kubernetes.default.svc:443",
		"OPEN [fd00::1]:6443",
	} {
		if target, ok := parseOpen(line); !ok || target == "" {
			t.Fatalf("expected %q to parse, got %q ok=%v", line, target, ok)
		}
	}
	for _, line := range []string{
		"OPEN",
		"OPEN ",
		"OPEN 10.0.0.1",
		"OPEN :6443",
		"OPEN 10.0.0.1:",
		"PING",
		"open 10.0.0.1:6443",
	} {
		if target, ok := parseOpen(line); ok {
			t.Fatalf("expected %q to be rejected, got %q", line, target)
		}
	}
}

func TestReadLineRejectsOverLongLine(t *testing.T) {
	long := make([]byte, maxLineBytes+64)
	for i := range long {
		long[i] = 'a'
	}
	long[len(long)-1] = '\n'
	// A reader sized like the real one cannot hold the line, so the caller sees an
	// error rather than a silently truncated (and therefore different) command.
	if _, err := readLine(bufio.NewReaderSize(newStringReader(string(long)), maxLineBytes)); err == nil {
		t.Fatal("expected an over-long line to be rejected")
	}
}

func TestLoadSettingsRequiresEndpointAndToken(t *testing.T) {
	t.Setenv("NUPHOS_RELAY_ENDPOINT", "")
	t.Setenv("NUPHOS_RELAY_TOKEN", "")
	if _, err := loadSettings(); err == nil {
		t.Fatal("expected a missing endpoint to fail")
	}

	t.Setenv("NUPHOS_RELAY_ENDPOINT", "relay.nuphos.ai")
	t.Setenv("NUPHOS_RELAY_TOKEN", "token")
	if _, err := loadSettings(); err == nil {
		t.Fatal("expected an endpoint without a port to fail")
	}

	t.Setenv("NUPHOS_RELAY_ENDPOINT", "relay.nuphos.ai:8444")
	loaded, err := loadSettings()
	if err != nil {
		t.Fatalf("expected valid settings, got %v", err)
	}
	if loaded.poolSize != 4 || loaded.idleAfter != 90*time.Second {
		t.Fatalf("unexpected defaults: %+v", loaded)
	}

	t.Setenv("NUPHOS_RELAY_POOL_SIZE", "0")
	if _, err := loadSettings(); err == nil {
		t.Fatal("expected a zero pool size to fail")
	}
}

// net/http reads the proxy environment once per process, so both cases have to
// be covered off a single configuration — which is also how the agent sees it in
// a pod, where the environment is fixed before it starts.
func TestProxyForEndpointHonoursEnvironment(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://egress.corp.internal")
	t.Setenv("NO_PROXY", "relay.internal")

	proxy, err := proxyForEndpoint("relay.nuphos.ai:8444")
	if err != nil || proxy == nil {
		t.Fatalf("expected HTTPS_PROXY to apply, got %v %v", proxy, err)
	}
	if got := proxyAddress(proxy); got != "egress.corp.internal:80" {
		t.Fatalf("unexpected proxy address %q", got)
	}

	exempt, err := proxyForEndpoint("relay.internal:8444")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if exempt != nil {
		t.Fatalf("expected NO_PROXY to exempt the endpoint, got %v", exempt)
	}
}

// The full round trip an agent performs: park on the relay, take an OPEN, dial
// the named in-cluster address, and splice bytes both ways.
func TestParkOnceServesStream(t *testing.T) {
	echo := listenEcho(t)
	relay := listenTLS(t)

	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := relay.Accept()
		if err != nil {
			close(accepted)
			return
		}
		accepted <- conn
	}()

	var streams sync.WaitGroup
	parked := make(chan error, 1)
	go func() {
		parked <- parkOnce(context.Background(), settings{
			endpoint:  relay.Addr().String(),
			token:     "agent-token",
			idleAfter: 5 * time.Second,
			insecure:  true,
		}, &streams)
	}()

	conn := <-accepted
	if conn == nil {
		t.Fatal("relay did not accept a connection")
	}
	defer func() { _ = conn.Close() }()
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReaderSize(conn, maxLineBytes)

	hello, err := readLine(reader)
	if err != nil {
		t.Fatalf("read hello: %v", err)
	}
	if want := protocolVersion + " AGENT agent-token " + agentVersion; hello != want {
		t.Fatalf("unexpected hello %q, want %q", hello, want)
	}
	if err := writeLine(conn, "READY"); err != nil {
		t.Fatal(err)
	}
	if err := writeLine(conn, "OPEN %s", echo.Addr().String()); err != nil {
		t.Fatal(err)
	}

	// parkOnce hands the connection off as soon as it reads OPEN, so the slot is
	// free to dial a replacement while this stream is still running.
	if err := <-parked; err != nil {
		t.Fatalf("parkOnce returned %v", err)
	}

	if line, err := readLine(reader); err != nil || line != "OK" {
		t.Fatalf("expected OK, got %q (%v)", line, err)
	}
	if _, err := conn.Write([]byte("ping-through-tunnel")); err != nil {
		t.Fatal(err)
	}
	if err := conn.(*tls.Conn).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	echoed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read echo: %v", err)
	}
	if string(echoed) != "ping-through-tunnel" {
		t.Fatalf("unexpected echo %q", echoed)
	}
	streams.Wait()
}

func TestParkOnceRejectsUnexpectedCommand(t *testing.T) {
	relay := listenTLS(t)
	go func() {
		conn, err := relay.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		reader := bufio.NewReaderSize(conn, maxLineBytes)
		if _, err := readLine(reader); err != nil {
			return
		}
		_ = writeLine(conn, "READY")
		_ = writeLine(conn, "SHIP-A-SHELL /bin/sh")
	}()

	var streams sync.WaitGroup
	err := parkOnce(context.Background(), settings{
		endpoint:  relay.Addr().String(),
		token:     "agent-token",
		idleAfter: 5 * time.Second,
		insecure:  true,
	}, &streams)
	if err == nil {
		t.Fatal("expected an unknown command to drop the connection")
	}
}

func TestParkOnceFailsWhenRelayRefuses(t *testing.T) {
	relay := listenTLS(t)
	go func() {
		conn, err := relay.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		reader := bufio.NewReaderSize(conn, maxLineBytes)
		if _, err := readLine(reader); err != nil {
			return
		}
		_ = writeLine(conn, "ERR unauthorized")
	}()

	var streams sync.WaitGroup
	err := parkOnce(context.Background(), settings{
		endpoint:  relay.Addr().String(),
		token:     "revoked",
		idleAfter: 5 * time.Second,
		insecure:  true,
	}, &streams)
	if err == nil {
		t.Fatal("expected a refused agent to fail")
	}
}

func listenEcho(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
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

func listenTLS(t *testing.T) net.Listener {
	t.Helper()
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{selfSigned(t)}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

func selfSigned(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "relay-test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

type stringReader struct {
	data string
	at   int
}

func newStringReader(data string) *stringReader { return &stringReader{data: data} }

func (r *stringReader) Read(p []byte) (int, error) {
	if r.at >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.at:])
	r.at += n
	return n, nil
}
