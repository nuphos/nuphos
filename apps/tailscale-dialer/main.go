package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "tailscale.com/feature/oauthkey"
	"tailscale.com/tsnet"
)

const maxRequestBytes = 64 << 10

var (
	identityKeyPattern = regexp.MustCompile(`^[a-f0-9]{24}:[a-f0-9]{24}$`)
	hostnamePattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	tagPattern         = regexp.MustCompile(`^tag:[a-z0-9][a-z0-9-]{0,62}$`)
)

type config struct {
	listenAddr string
	token      string
	stateRoot  string
	idleTTL    time.Duration
}

type proxyRequest struct {
	IdentityKey  string `json:"identityKey"`
	Hostname     string `json:"hostname"`
	ClientSecret string `json:"clientSecret"`
	Tag          string `json:"tag"`
}

type proxyResponse struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type proxyEntry struct {
	server      *tsnet.Server
	stateDir    string
	fingerprint string
	response    proxyResponse
	lastUsed    time.Time
}

type proxyManager struct {
	mu        sync.Mutex
	entries   map[string]*proxyEntry
	stateRoot string
	idleTTL   time.Duration
}

func newProxyManager(stateRoot string, idleTTL time.Duration) *proxyManager {
	return &proxyManager{entries: make(map[string]*proxyEntry), stateRoot: stateRoot, idleTTL: idleTTL}
}

func validateProxyRequest(request proxyRequest) error {
	if !identityKeyPattern.MatchString(request.IdentityKey) {
		return errors.New("identityKey must contain a team ID and binding ID")
	}
	if !hostnamePattern.MatchString(request.Hostname) {
		return errors.New("hostname is invalid")
	}
	if request.ClientSecret == "" || len(request.ClientSecret) > 4096 {
		return errors.New("clientSecret is invalid")
	}
	if !tagPattern.MatchString(request.Tag) {
		return errors.New("tag must use the tag:name format")
	}
	return nil
}

func requestFingerprint(request proxyRequest) string {
	digest := sha256.Sum256([]byte(request.ClientSecret + "\x00" + request.Tag))
	return hex.EncodeToString(digest[:])
}

func (manager *proxyManager) proxy(request proxyRequest) (proxyResponse, error) {
	if err := validateProxyRequest(request); err != nil {
		return proxyResponse{}, err
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()

	fingerprint := requestFingerprint(request)
	if existing := manager.entries[request.IdentityKey]; existing != nil {
		if existing.fingerprint == fingerprint {
			existing.lastUsed = time.Now()
			return existing.response, nil
		}
		manager.closeEntry(existing)
		delete(manager.entries, request.IdentityKey)
	}

	stateDir, err := os.MkdirTemp(manager.stateRoot, "identity-")
	if err != nil {
		return proxyResponse{}, fmt.Errorf("create state directory: %w", err)
	}
	server := &tsnet.Server{
		Hostname:      request.Hostname,
		Dir:           stateDir,
		Ephemeral:     true,
		AuthKey:       request.ClientSecret,
		AdvertiseTags: []string{request.Tag},
	}
	addr, proxyCredential, _, err := server.Loopback()
	if err != nil {
		_ = server.Close()
		_ = os.RemoveAll(stateDir)
		return proxyResponse{}, fmt.Errorf("start tsnet identity: %w", err)
	}
	host, portText, err := net.SplitHostPort(addr)
	if err != nil {
		_ = server.Close()
		_ = os.RemoveAll(stateDir)
		return proxyResponse{}, fmt.Errorf("parse loopback address: %w", err)
	}
	port, err := strconv.Atoi(portText)
	ip := net.ParseIP(host)
	if err != nil || port < 1 || port > 65535 || ip == nil || !ip.IsLoopback() {
		_ = server.Close()
		_ = os.RemoveAll(stateDir)
		return proxyResponse{}, errors.New("tsnet returned a non-loopback proxy")
	}
	response := proxyResponse{Host: host, Port: port, Username: "tsnet", Password: proxyCredential}
	manager.entries[request.IdentityKey] = &proxyEntry{
		server: server, stateDir: stateDir, fingerprint: fingerprint, response: response, lastUsed: time.Now(),
	}
	return response, nil
}

func (manager *proxyManager) closeEntry(entry *proxyEntry) {
	if err := entry.server.Close(); err != nil {
		slog.Warn("failed to close tsnet identity", "error", err)
	}
	if err := os.RemoveAll(entry.stateDir); err != nil {
		slog.Warn("failed to remove tsnet state", "error", err)
	}
}

func (manager *proxyManager) cleanup(now time.Time) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	for key, entry := range manager.entries {
		if now.Sub(entry.lastUsed) < manager.idleTTL {
			continue
		}
		manager.closeEntry(entry)
		delete(manager.entries, key)
	}
}

func (manager *proxyManager) close() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	for key, entry := range manager.entries {
		manager.closeEntry(entry)
		delete(manager.entries, key)
	}
}

type server struct {
	token   string
	manager *proxyManager
}

func (service *server) authorized(header string) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	provided := strings.TrimPrefix(header, prefix)
	return len(provided) == len(service.token) && subtle.ConstantTimeCompare([]byte(provided), []byte(service.token)) == 1
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func (service *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/proxies", func(writer http.ResponseWriter, request *http.Request) {
		if !service.authorized(request.Header.Get("Authorization")) {
			writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBytes)
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		var input proxyRequest
		if err := decoder.Decode(&input); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		response, err := service.manager.proxy(input)
		if err != nil {
			slog.Warn("tsnet proxy setup failed", "identity", input.IdentityKey, "error", err)
			writeJSON(writer, http.StatusBadGateway, map[string]string{"error": "could not establish tailnet identity"})
			return
		}
		writeJSON(writer, http.StatusOK, response)
	})
	return mux
}

func loadConfig() (config, error) {
	token := os.Getenv("NUPHOS_TAILSCALE_DIALER_TOKEN")
	if token == "" {
		return config{}, errors.New("NUPHOS_TAILSCALE_DIALER_TOKEN is required")
	}
	stateRoot := os.Getenv("NUPHOS_TAILSCALE_STATE_DIR")
	if stateRoot == "" {
		stateRoot = filepath.Join(os.TempDir(), "nuphos-tsnet")
	}
	if err := os.MkdirAll(stateRoot, 0o700); err != nil {
		return config{}, fmt.Errorf("create state root: %w", err)
	}
	idleTTL := 15 * time.Minute
	if raw := os.Getenv("NUPHOS_TAILSCALE_IDLE_TTL"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed < time.Minute || parsed > 24*time.Hour {
			return config{}, errors.New("NUPHOS_TAILSCALE_IDLE_TTL must be between 1m and 24h")
		}
		idleTTL = parsed
	}
	listenAddr := os.Getenv("NUPHOS_TAILSCALE_DIALER_ADDR")
	if listenAddr == "" {
		listenAddr = "127.0.0.1:4141"
	}
	host, _, err := net.SplitHostPort(listenAddr)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return config{}, errors.New("NUPHOS_TAILSCALE_DIALER_ADDR must be a loopback IP and port")
	}
	return config{listenAddr: listenAddr, token: token, stateRoot: stateRoot, idleTTL: idleTTL}, nil
}

func main() {
	settings, err := loadConfig()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	manager := newProxyManager(settings.stateRoot, settings.idleTTL)
	defer manager.close()
	service := &server{token: settings.token, manager: manager}
	httpServer := &http.Server{
		Addr: settings.listenAddr, Handler: service.routes(), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 35 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case now := <-ticker.C:
				manager.cleanup(now)
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownContext)
	}()

	slog.Info("Tailscale database dialer listening", "address", settings.listenAddr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("dialer stopped", "error", err)
		os.Exit(1)
	}
}
