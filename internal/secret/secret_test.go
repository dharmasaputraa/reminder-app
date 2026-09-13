package secret

import (
	"bytes"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	key := DeriveKey("super-secret-long-enough-16")
	plain := []byte(`{"token":"secret"}`)
	blob, err := Encrypt(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(blob, plain) {
		t.Error("plaintext must not be visible in the blob")
	}
	got, err := Decrypt(key, blob)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plain) {
		t.Errorf("got %q", got)
	}
}

func TestTamperFails(t *testing.T) {
	key := DeriveKey("super-secret-long-enough-16")
	blob, _ := Encrypt(key, []byte("data"))
	blob[len(blob)-1] ^= 0xFF
	if _, err := Decrypt(key, blob); err == nil {
		t.Error("tampered blob must fail auth")
	}
}

func TestWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt(DeriveKey("key-one-long-enough-16"), []byte("data"))
	if _, err := Decrypt(DeriveKey("key-two-long-enough-16"), blob); err == nil {
		t.Error("wrong key must fail")
	}
}
