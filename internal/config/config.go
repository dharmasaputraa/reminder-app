package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

const (
	AuthCFAccess = "cfaccess"
	AuthDev      = "dev"
)

type Config struct {
	Addr         string
	DataDir      string
	AppSecret    string
	AuthMode     string
	CFTeamDomain string
	CFAud        string
	AdminEmails  map[string]bool
	TZ           string

	// Dev only (AUTH_MODE=dev): when both are set, the server seeds a Telegram
	// channel for the first ADMIN_EMAILS entry at startup.
	DevSeedTelegramBotToken string
	DevSeedTelegramChatID   string
}

func Load() (Config, error) {
	c := Config{
		Addr:                    envOr("ADDR", ":8080"),
		DataDir:                 envOr("DATA_DIR", "./data"),
		AppSecret:               os.Getenv("APP_SECRET"),
		AuthMode:                envOr("AUTH_MODE", AuthCFAccess),
		CFTeamDomain:            os.Getenv("CF_ACCESS_TEAM_DOMAIN"),
		CFAud:                   os.Getenv("CF_ACCESS_AUD"),
		TZ:                      envOr("TZ", "Asia/Makassar"),
		AdminEmails:             map[string]bool{},
		DevSeedTelegramBotToken: os.Getenv("DEV_SEED_TELEGRAM_BOT_TOKEN"),
		DevSeedTelegramChatID:   os.Getenv("DEV_SEED_TELEGRAM_CHAT_ID"),
	}
	for _, e := range strings.Split(os.Getenv("ADMIN_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails[e] = true
		}
	}
	if c.AuthMode != AuthCFAccess && c.AuthMode != AuthDev {
		return c, fmt.Errorf("AUTH_MODE must be %q or %q", AuthCFAccess, AuthDev)
	}
	if len(c.AppSecret) < 16 {
		return c, errors.New("APP_SECRET is required, at least 16 characters (AES-256-GCM key)")
	}
	if c.AuthMode == AuthCFAccess && (c.CFTeamDomain == "" || c.CFAud == "") {
		return c, errors.New("AUTH_MODE=cfaccess requires CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD")
	}
	if (c.DevSeedTelegramBotToken == "") != (c.DevSeedTelegramChatID == "") {
		return c, errors.New("DEV_SEED_TELEGRAM_BOT_TOKEN and DEV_SEED_TELEGRAM_CHAT_ID must be set together")
	}
	return c, nil
}

// LoadDotEnv reads KEY=VALUE lines from path into the environment without
// overriding variables that are already set. A missing file is not an error —
// it is a convenience for dev so secrets do not have to live in the Makefile.
func LoadDotEnv(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if k != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

func (c Config) DBPath() string { return c.DataDir + "/wimember.db" }

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
