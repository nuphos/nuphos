package main

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"strings"
)

// Wire protocol v1. The agent holds a pool of idle connections to the relay and
// never initiates anything; the relay drives every stream. Lines are ASCII and
// LF-terminated until the stream is established, then it is raw bytes both ways.
//
//	agent -> relay   NUPHOS-RELAY/1 AGENT <token>
//	relay -> agent   PING                          (idle keepalive)
//	agent -> relay   PONG
//	relay -> agent   OPEN <host>:<port>
//	agent -> relay   OK | ERR <reason>
//	                 ...raw payload...
//
// Deliberately not HTTP or WebSocket: a raw TLS stream needs no framing on
// either side, and a corporate egress proxy tunnels it with the same CONNECT it
// would use for any HTTPS request.
const protocolVersion = "NUPHOS-RELAY/1"

// Long enough for a signed token, short enough that a wrong-protocol peer
// (someone pointing a browser at the agent port) cannot make us buffer.
const maxLineBytes = 1024

func writeLine(conn net.Conn, format string, args ...any) error {
	_, err := fmt.Fprintf(conn, format+"\n", args...)
	return err
}

// readLine bounds the read itself rather than checking the length afterwards.
// ReadString would keep allocating until it found a newline, which on a listener
// that anyone can reach lets an unauthenticated peer force large allocations
// before it has said who it is. ReadSlice cannot grow past the reader's buffer,
// so a peer that never sends one costs exactly maxLineBytes.
func readLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) {
		return "", errors.New("line too long")
	}
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(line), "\r\n"), nil
}

// parseOpen returns the dial target of an OPEN command. It only checks the
// shape (host:port), never the destination: what this agent is allowed to reach
// is the cluster's NetworkPolicy to decide, not ours.
func parseOpen(line string) (target string, ok bool) {
	rest, found := strings.CutPrefix(line, "OPEN ")
	if !found {
		return "", false
	}
	target = strings.TrimSpace(rest)
	host, port, err := net.SplitHostPort(target)
	if err != nil || host == "" || port == "" {
		return "", false
	}
	return target, true
}
