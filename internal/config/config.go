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
}

func Load() (Config, error) {
	c := Config{
		Addr:         envOr("ADDR", ":8080"),
		DataDir:      envOr("DATA_DIR", "./data"),
		AppSecret:    os.Getenv("APP_SECRET"),
		AuthMode:     envOr("AUTH_MODE", AuthCFAccess),
		CFTeamDomain: os.Getenv("CF_ACCESS_TEAM_DOMAIN"),
		CFAud:        os.Getenv("CF_ACCESS_AUD"),
		TZ:           envOr("TZ", "Asia/Makassar"),
		AdminEmails:  map[string]bool{},
	}
	for _, e := range strings.Split(os.Getenv("ADMIN_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails[e] = true
		}
	}
	if c.AuthMode != AuthCFAccess && c.AuthMode != AuthDev {
		return c, fmt.Errorf("AUTH_MODE harus %q atau %q", AuthCFAccess, AuthDev)
	}
	if len(c.AppSecret) < 16 {
		return c, errors.New("APP_SECRET wajib terisi, minimal 16 karakter (kunci AES-256-GCM)")
	}
	if c.AuthMode == AuthCFAccess && (c.CFTeamDomain == "" || c.CFAud == "") {
		return c, errors.New("AUTH_MODE=cfaccess membutuhkan CF_ACCESS_TEAM_DOMAIN dan CF_ACCESS_AUD")
	}
	return c, nil
}

func (c Config) DBPath() string { return c.DataDir + "/otorem.db" }

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
