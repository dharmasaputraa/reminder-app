package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
)

// DeriveKey: APP_SECRET string env → kunci 32 byte untuk AES-256-GCM.
func DeriveKey(appSecret string) []byte {
	k := sha256.Sum256([]byte(appSecret))
	return k[:]
}

func Encrypt(key, plaintext []byte) ([]byte, error) {
	gcm, err := gcm(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func Decrypt(key, blob []byte) ([]byte, error) {
	gcm, err := gcm(key)
	if err != nil {
		return nil, err
	}
	if len(blob) < gcm.NonceSize() {
		return nil, errors.New("blob terlalu pendek")
	}
	return gcm.Open(nil, blob[:gcm.NonceSize()], blob[gcm.NonceSize():], nil)
}

func gcm(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("kunci harus 32 byte, dapat %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
