package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Tokens are HMAC-signed and self-describing so the relay needs no database and
// no callback to the backend to authorise a connection. The backend mints them
// with the same scheme (apps/backend/src/lib/byos/relay-token.ts) — keep the two
// in step.
//
//	nr1_<base64url(payload)>.<base64url(hmac-sha256(payload))>
//
// The payload is small on purpose: the cluster key, what the holder is allowed
// to be, and an expiry.
const tokenPrefix = "nr1_"

type tokenPurpose string

const (
	// Lives in a customer's cluster Secret for as long as the pod does.
	purposeAgent tokenPurpose = "agent"
	// Handed to one agent sandbox for the life of one session.
	purposeSession tokenPurpose = "session"
)

type tokenClaims struct {
	// Cluster this token is scoped to. Opaque and random — never a team id, so a
	// leaked token reveals nothing about who it belongs to.
	Cluster string       `json:"k"`
	Purpose tokenPurpose `json:"p"`
	Expires int64        `json:"exp"`
	// Present on session tokens; carried only so a stream can be logged against
	// the session that opened it.
	Session string `json:"s,omitempty"`
}

func signToken(secret []byte, claims tokenClaims) (string, error) {
	encoded, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(encoded)
	return tokenPrefix + payload + "." + base64.RawURLEncoding.EncodeToString(macFor(secret, payload)), nil
}

// The label a status credential is derived under. Kept out of the token
// namespace so a status header can never be replayed as a token.
const statusCredentialLabel = "nuphos-relay-status-v1"

// statusCredential derives the value /status accepts, rather than accepting the
// signing secret itself. The health listener is plain HTTP, so a captured header
// would otherwise hand over the key that mints agent and session tokens for
// every enrolled cluster — the widest possible credential for the narrowest
// possible endpoint. The backend derives the same value
// (relayStatusCredential in apps/backend/src/lib/byos/relay-token.ts).
func statusCredential(secret []byte) string {
	return hex.EncodeToString(macFor(secret, statusCredentialLabel))
}

func macFor(secret []byte, payload string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}

// verifyToken checks the signature before it looks at anything inside, and never
// reports why a token failed to the peer — an oracle that distinguishes "expired"
// from "wrong signature" is free information for whoever is probing.
func verifyToken(secret []byte, token string, now time.Time) (tokenClaims, error) {
	body, found := strings.CutPrefix(token, tokenPrefix)
	if !found {
		return tokenClaims{}, errors.New("malformed token")
	}
	payload, signature, found := strings.Cut(body, ".")
	if !found {
		return tokenClaims{}, errors.New("malformed token")
	}
	provided, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return tokenClaims{}, errors.New("malformed token")
	}
	if !hmac.Equal(provided, macFor(secret, payload)) {
		return tokenClaims{}, errors.New("bad signature")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return tokenClaims{}, errors.New("malformed token")
	}
	var claims tokenClaims
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return tokenClaims{}, errors.New("malformed token")
	}
	if claims.Cluster == "" {
		return tokenClaims{}, errors.New("token has no cluster")
	}
	if claims.Expires <= 0 || now.After(time.Unix(claims.Expires, 0)) {
		return tokenClaims{}, errors.New("token expired")
	}
	return claims, nil
}

func verifyTokenFor(secret []byte, token string, purpose tokenPurpose, now time.Time) (tokenClaims, error) {
	claims, err := verifyToken(secret, token, now)
	if err != nil {
		return tokenClaims{}, err
	}
	if claims.Purpose != purpose {
		return tokenClaims{}, fmt.Errorf("token is not a %s token", purpose)
	}
	return claims, nil
}
