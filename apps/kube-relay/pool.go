package main

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"sync"
	"time"
)

var errNoAgent = errors.New("no agent connection available for this cluster")

// A connection an agent has parked and is waiting on. Exactly one goroutine —
// the one in run — reads or writes it while it is idle, so keepalives can never
// race a claim for the same bytes.
type parkedConn struct {
	cluster string
	conn    net.Conn
	reader  *bufio.Reader
	claims  chan claim
	dead    chan struct{}
}

// What an operator needs to tell "connected" from "enrolled": whether anything
// is parked, when we last heard from it, and which agent build it is. Kept
// per-cluster rather than per-connection so it survives the pool draining and
// refilling, which is normal traffic rather than an outage.
type clusterPresence struct {
	Idle         int    `json:"idle"`
	LastSeenAt   string `json:"lastSeenAt"`
	AgentVersion string `json:"agentVersion,omitempty"`
}

type claim struct {
	target string
	result chan claimResult
}

// A successful claim transfers ownership of the connection to the claimer: the
// reader comes with it because it may already hold bytes read past the OK line.
type claimResult struct {
	conn   net.Conn
	reader *bufio.Reader
	err    error
}

type pool struct {
	mu           sync.Mutex
	idle         map[string][]*parkedConn
	presence     map[string]*clusterPresence
	pingInterval time.Duration
	pingTimeout  time.Duration
	openTimeout  time.Duration
	// Injected so tests can pin it; production passes time.Now.
	now func() time.Time
}

func newPool(pingInterval, pingTimeout, openTimeout time.Duration) *pool {
	return &pool{
		idle:         map[string][]*parkedConn{},
		presence:     map[string]*clusterPresence{},
		pingInterval: pingInterval,
		pingTimeout:  pingTimeout,
		openTimeout:  openTimeout,
		now:          time.Now,
	}
}

// park takes ownership of a freshly authenticated agent connection and blocks
// until it is claimed or dies, so the accept loop can call it in a goroutine and
// forget about it.
func (p *pool) park(cluster string, conn net.Conn, reader *bufio.Reader, agentVersion string) {
	parked := &parkedConn{
		cluster: cluster,
		conn:    conn,
		reader:  reader,
		claims:  make(chan claim),
		dead:    make(chan struct{}),
	}
	p.mu.Lock()
	p.idle[cluster] = append(p.idle[cluster], parked)
	p.seenLocked(cluster, agentVersion)
	p.mu.Unlock()
	parked.run(p)
}

// seenLocked stamps the cluster as heard-from. Caller holds the mutex.
func (p *pool) seenLocked(cluster, agentVersion string) {
	entry := p.presence[cluster]
	if entry == nil {
		entry = &clusterPresence{}
		p.presence[cluster] = entry
	}
	entry.LastSeenAt = p.now().UTC().Format(time.RFC3339)
	if agentVersion != "" {
		entry.AgentVersion = agentVersion
	}
}

func (p *pool) seen(cluster, agentVersion string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.seenLocked(cluster, agentVersion)
}

func (p *pool) remove(parked *parkedConn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	remaining := p.idle[parked.cluster]
	for index, candidate := range remaining {
		if candidate == parked {
			p.idle[parked.cluster] = append(remaining[:index], remaining[index+1:]...)
			break
		}
	}
	if len(p.idle[parked.cluster]) == 0 {
		delete(p.idle, parked.cluster)
	}
}

// take removes the longest-parked connection for a cluster. Oldest first, so a
// connection that has been idle long enough for a middlebox to have quietly
// dropped it is the one that gets exercised (and replaced) rather than lingering.
func (p *pool) take(cluster string) *parkedConn {
	p.mu.Lock()
	defer p.mu.Unlock()
	waiting := p.idle[cluster]
	if len(waiting) == 0 {
		return nil
	}
	parked := waiting[0]
	if len(waiting) == 1 {
		delete(p.idle, cluster)
	} else {
		p.idle[cluster] = waiting[1:]
	}
	return parked
}

// clusters reports presence for every cluster heard from since start. A cluster
// whose pool has drained still appears, with idle 0 and its last-seen time —
// "was here a minute ago" and "never showed up" are different answers and the
// enrolment UI needs to tell them apart.
func (p *pool) clusters() map[string]clusterPresence {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]clusterPresence, len(p.presence))
	for cluster, entry := range p.presence {
		snapshot := *entry
		snapshot.Idle = len(p.idle[cluster])
		out[cluster] = snapshot
	}
	return out
}

func (p *pool) idleCounts() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	counts := make(map[string]int, len(p.idle))
	for cluster, waiting := range p.idle {
		counts[cluster] = len(waiting)
	}
	return counts
}

// How long a request waits for a cluster with an empty pool before giving up.
// Covers the seconds-long window where every connection is in flight at once: a
// relay restart, a rolling update of the customer's Deployment, or a burst of
// concurrent streams that momentarily drains the pool. Without it those windows
// surface as a hard failure that reads exactly like "the customer's pod is down",
// which is the wrong thing to tell an operator about a blip.
const agentWaitTimeout = 5 * time.Second

// Polled rather than signalled on purpose: this only runs while a cluster has no
// idle connection at all, which is rare and brief, and a waiter registry would
// add coordination to park/take for no gain at this rate.
const agentWaitPoll = 25 * time.Millisecond

// open asks the cluster's agent to dial target and hands back the connection to
// splice. A connection that turns out to be dead is skipped rather than
// surfaced: the pool exists so one stale connection is not a failed request.
func (p *pool) open(cluster, target string) (claimResult, error) {
	deadline := time.Now().Add(agentWaitTimeout)
	for {
		parked := p.take(cluster)
		if parked == nil {
			if time.Now().After(deadline) {
				return claimResult{}, errNoAgent
			}
			time.Sleep(agentWaitPoll)
			continue
		}
		pending := claim{target: target, result: make(chan claimResult, 1)}
		select {
		case parked.claims <- pending:
			return <-pending.result, nil
		case <-parked.dead:
			continue
		}
	}
}

// run owns an idle connection: keepalive until claimed, then hand it over.
func (parked *parkedConn) run(p *pool) {
	defer close(parked.dead)
	keepalive := time.NewTicker(p.pingInterval)
	defer keepalive.Stop()

	for {
		select {
		case pending := <-parked.claims:
			// Already removed from the pool by take.
			pending.result <- parked.openStream(pending.target, p.openTimeout)
			return
		case <-keepalive.C:
			if err := parked.ping(p.pingTimeout); err == nil {
				p.seen(parked.cluster, "")
			} else {
				slog.Info("parked agent connection failed keepalive", "cluster", parked.cluster, "error", err)
				p.remove(parked)
				_ = parked.conn.Close()
				return
			}
		}
	}
}

func (parked *parkedConn) ping(timeout time.Duration) error {
	if err := parked.conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return err
	}
	if err := writeLine(parked.conn, "PING"); err != nil {
		return err
	}
	line, err := readLine(parked.reader)
	if err != nil {
		return err
	}
	if line != "PONG" {
		return errors.New("expected PONG, got " + line)
	}
	return nil
}

func (parked *parkedConn) openStream(target string, timeout time.Duration) claimResult {
	if err := parked.conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		_ = parked.conn.Close()
		return claimResult{err: err}
	}
	if err := writeLine(parked.conn, "OPEN %s", target); err != nil {
		_ = parked.conn.Close()
		return claimResult{err: err}
	}
	line, err := readLine(parked.reader)
	if err != nil {
		_ = parked.conn.Close()
		return claimResult{err: err}
	}
	if line != "OK" {
		_ = parked.conn.Close()
		return claimResult{err: errors.New("agent could not reach the target: " + line)}
	}
	if err := parked.conn.SetDeadline(time.Time{}); err != nil {
		_ = parked.conn.Close()
		return claimResult{err: err}
	}
	return claimResult{conn: parked.conn, reader: parked.reader}
}
