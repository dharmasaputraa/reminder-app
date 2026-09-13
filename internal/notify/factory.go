package notify

import (
	"encoding/json"
	"fmt"

	"otorem/internal/secret"
	"otorem/internal/store"
)

// NewFromChannel: decrypt config channel → Notifier konkret.
func NewFromChannel(ch store.Channel, key []byte) (Notifier, error) {
	plain, err := secret.Decrypt(key, ch.ConfigEnc)
	if err != nil {
		return nil, fmt.Errorf("dekripsi config channel %q: %w", ch.Name, err)
	}
	switch ch.Type {
	case "gotify":
		var c GotifyConfig
		if err := json.Unmarshal(plain, &c); err != nil {
			return nil, err
		}
		return NewGotify(c), nil
	case "telegram":
		var c TelegramConfig
		if err := json.Unmarshal(plain, &c); err != nil {
			return nil, err
		}
		return NewTelegram(c), nil
	case "email":
		var c SMTPConfig
		if err := json.Unmarshal(plain, &c); err != nil {
			return nil, err
		}
		return NewSMTP(c), nil
	default:
		return nil, fmt.Errorf("tipe channel tidak dikenal: %q", ch.Type)
	}
}
