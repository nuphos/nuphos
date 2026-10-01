package main

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"strings"
)

// Peer side of the protocol documented in apps/kube-relay-agent. The relay
// drives it: agents only ever answer.
const protocolVersion = "NUPHOS-RELAY/1"

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

// parseAgentHello accepts an optional trailing version, which older agents do
// not send. It is reported back to the operator ("this cluster is still on an
// agent from March"), never used to gate anything — an agent that cannot be
// upgraded must keep working.
func parseAgentHello(line string) (token string, version string, err error) {
	fields := strings.Fields(line)
	if len(fields) < 3 || len(fields) > 4 || fields[0] != protocolVersion || fields[1] != "AGENT" {
		return "", "", errors.New("expected " + protocolVersion + " AGENT <token> [version]")
	}
	if len(fields) == 4 {
		version = fields[3]
	}
	return fields[2], version, nil
}
