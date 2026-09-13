package config

import (
	"os"
	"testing"
)

// configEnvVars is every environment variable read by Load().
var configEnvVars = []string{
	"ADDR",
	"DATA_DIR",
	"APP_SECRET",
	"AUTH_MODE",
	"CF_ACCESS_TEAM_DOMAIN",
	"CF_ACCESS_AUD",
	"ADMIN_EMAILS",
	"TZ",
}

// setEnv starts from a clean environment (all config vars removed),
// applies kv, then restores the original environment (old values or
// removed) on cleanup — same semantics as t.Setenv. Do not use t.Parallel():
// the env is global to the process.
func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	clearEnv(t)
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range configEnvVars {
		prev, had := os.LookupEnv(k)
		os.Unsetenv(k)
		t.Cleanup(func() {
			if had {
				os.Setenv(k, prev)
			} else {
				os.Unsetenv(k)
			}
		})
	}
}

func validEnv() map[string]string {
	return map[string]string{
		"APP_SECRET":            "super-secret-panjang-16",
		"CF_ACCESS_TEAM_DOMAIN": "contoh.cloudflareaccess.com",
		"CF_ACCESS_AUD":         "abc.access",
		"ADMIN_EMAILS":          "Admin@X.com, user@y.com",
	}
}

func TestLoadValid(t *testing.T) {
	setEnv(t, validEnv())
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" {
		t.Errorf("Addr default = %q", c.Addr)
	}
	if c.DBPath() != "./data/otorem.db" {
		t.Errorf("DBPath = %q", c.DBPath())
	}
	if !c.AdminEmails["admin@x.com"] {
		t.Errorf("email admin harus di-lowercase: %v", c.AdminEmails)
	}
}

func TestLoadRejectsShortSecret(t *testing.T) {
	setEnv(t, map[string]string{"APP_SECRET": "pendek"})
	if _, err := Load(); err == nil {
		t.Error("secret pendek harus error")
	}
}

func TestLoadCFAccessRequiresTeamAndAud(t *testing.T) {
	setEnv(t, map[string]string{"APP_SECRET": "super-secret-panjang-16"})
	if _, err := Load(); err == nil {
		t.Error("cfaccess tanpa team/aud harus error")
	}
}

func TestLoadDevModeOK(t *testing.T) {
	setEnv(t, map[string]string{"APP_SECRET": "super-secret-panjang-16", "AUTH_MODE": "dev"})
	if _, err := Load(); err != nil {
		t.Errorf("dev mode tanpa CF env harus valid: %v", err)
	}
}
