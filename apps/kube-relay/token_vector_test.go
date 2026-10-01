package main

import (
	"testing"
	"time"
)

// The same vector as apps/backend/src/lib/byos/relay-token.test.ts. Tokens are
// signed over the exact payload bytes, so field order and the omission of an
// empty `s` are a cross-language contract: if either side changes how it
// serialises a token, one of these two tests fails instead of every enrolled
// cluster silently failing to authenticate.
const (
	vectorSecret = "0123456789abcdef0123456789abcdef"
	vectorToken  = "nr1_eyJrIjoiY2x1c3Rlci1rZXkiLCJwIjoic2Vzc2lvbiIsImV4cCI6MTcwMDAwMzYwMCwicyI6InNlc3Npb24tMSJ9.OHW_TwFLeewmNs3fbQq6MOKrdLNScZO2Uy0l1IbxiX8"
)

func TestTokenVectorMatchesBackend(t *testing.T) {
	claims := tokenClaims{
		Cluster: "cluster-key",
		Purpose: purposeSession,
		Expires: 1_700_003_600,
		Session: "session-1",
	}
	signed, err := signToken([]byte(vectorSecret), claims)
	if err != nil {
		t.Fatal(err)
	}
	if signed != vectorToken {
		t.Fatalf("token encoding drifted from the backend's:\n got  %s\n want %s", signed, vectorToken)
	}

	verified, err := verifyTokenFor([]byte(vectorSecret), vectorToken, purposeSession, time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatalf("expected the backend's token to verify, got %v", err)
	}
	if verified.Cluster != "cluster-key" || verified.Session != "session-1" {
		t.Fatalf("unexpected claims %+v", verified)
	}
}

func TestAgentTokenVectorOmitsSession(t *testing.T) {
	signed, err := signToken([]byte(vectorSecret), tokenClaims{
		Cluster: "cluster-key", Purpose: purposeAgent, Expires: 1_700_003_600,
	})
	if err != nil {
		t.Fatal(err)
	}
	const want = "nr1_eyJrIjoiY2x1c3Rlci1rZXkiLCJwIjoiYWdlbnQiLCJleHAiOjE3MDAwMDM2MDB9"
	if len(signed) < len(want) || signed[:len(want)] != want {
		t.Fatalf("agent token payload drifted:\n got  %s\n want prefix %s", signed, want)
	}
}

// The status credential is the same cross-language contract as the token
// vector: apps/backend/src/lib/byos/relay-token.test.ts pins this string too, so
// a change on either side fails a test rather than locking the backend out of
// /status.
func TestStatusCredentialVectorMatchesBackend(t *testing.T) {
	const want = "ab6371f73fc715869d26690d6a1f1978b0bdf8e7207de097897732f3492c6d2e"
	if got := statusCredential([]byte(vectorSecret)); got != want {
		t.Fatalf("status credential derivation drifted:\n got  %s\n want %s", got, want)
	}
	if statusCredential([]byte(vectorSecret)) == vectorSecret {
		t.Fatal("the status credential must not be the signing secret")
	}
}
