package config

import (
	"os"
	"testing"
)

func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		os.Setenv(k, v)
	}
	t.Cleanup(func() {
		for k := range kv {
			os.Unsetenv(k)
		}
	})
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
