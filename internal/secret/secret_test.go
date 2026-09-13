package secret

import (
	"bytes"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	key := DeriveKey("super-secret-panjang-16")
	plain := []byte(`{"token":"rahasia"}`)
	blob, err := Encrypt(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(blob, plain) {
		t.Error("plaintext tidak boleh terlihat di blob")
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
	key := DeriveKey("super-secret-panjang-16")
	blob, _ := Encrypt(key, []byte("data"))
	blob[len(blob)-1] ^= 0xFF
	if _, err := Decrypt(key, blob); err == nil {
		t.Error("blob yang diubah harus gagal auth")
	}
}

func TestWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt(DeriveKey("kunci-satu-panjang-16"), []byte("data"))
	if _, err := Decrypt(DeriveKey("kunci-dua-panjang-16"), blob); err == nil {
		t.Error("kunci salah harus gagal")
	}
}
