package main

import "testing"

func TestValidateProxyRequest(t *testing.T) {
	valid := proxyRequest{
		IdentityKey:  "69e989027ab63e8d6a0ffcb6:69e989027ab63e8d6a0ffcb7",
		Hostname:     "nuphos-db-a0ffcb-a0ffcb",
		ClientSecret: "not-a-real-oauth-client-secret",
		Tag:          "tag:nuphos-database",
	}
	if err := validateProxyRequest(valid); err != nil {
		t.Fatalf("expected request to be valid: %v", err)
	}

	cases := []proxyRequest{
		{IdentityKey: "../escape", Hostname: valid.Hostname, ClientSecret: valid.ClientSecret, Tag: valid.Tag},
		{IdentityKey: valid.IdentityKey, Hostname: "BAD HOST", ClientSecret: valid.ClientSecret, Tag: valid.Tag},
		{IdentityKey: valid.IdentityKey, Hostname: valid.Hostname, ClientSecret: "", Tag: valid.Tag},
		{IdentityKey: valid.IdentityKey, Hostname: valid.Hostname, ClientSecret: valid.ClientSecret, Tag: "nuphos-database"},
	}
	for index, testCase := range cases {
		if err := validateProxyRequest(testCase); err == nil {
			t.Fatalf("case %d: expected validation error", index)
		}
	}
}

func TestRequestFingerprintChangesWithCredentialOrTag(t *testing.T) {
	base := proxyRequest{ClientSecret: "one", Tag: "tag:one"}
	if requestFingerprint(base) == requestFingerprint(proxyRequest{ClientSecret: "two", Tag: "tag:one"}) {
		t.Fatal("credential rotation must change the identity fingerprint")
	}
	if requestFingerprint(base) == requestFingerprint(proxyRequest{ClientSecret: "one", Tag: "tag:two"}) {
		t.Fatal("tag changes must change the identity fingerprint")
	}
}

func TestBearerAuthorization(t *testing.T) {
	service := &server{token: "test-token"}
	if !service.authorized("Bearer test-token") {
		t.Fatal("expected matching bearer token to authorize")
	}
	if service.authorized("Bearer wrong") || service.authorized("test-token") {
		t.Fatal("expected invalid authorization to be rejected")
	}
}
