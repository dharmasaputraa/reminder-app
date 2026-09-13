package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"otorem/internal/config"
	"otorem/internal/store"
)

type UserProvisioner interface {
	GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (store.User, error)
}

// NewCFAccessFromKeyfunc: verifikasi Cf-Access-Jwt-Assertion → provision user.
// Keyfunc di-inject agar bisa diuji dengan JWKS lokal.
func NewCFAccessFromKeyfunc(kf jwt.Keyfunc, aud string, provision UserProvisioner, adminEmails map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.GetHeader("Cf-Access-Jwt-Assertion"))
		if raw == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token Cloudflare Access tidak ada"})
			return
		}
		parsed, err := jwt.Parse(raw, kf,
			jwt.WithValidMethods([]string{"RS256"}),
			jwt.WithAudience(aud),
			jwt.WithExpirationRequired(),
		)
		if err != nil || !parsed.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("token tidak valid: %v", err)})
			return
		}
		claims, ok := parsed.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "klaim tidak terbaca"})
			return
		}
		email, _ := claims["email"].(string)
		name, _ := claims["name"].(string)
		if email == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "klaim email kosong — pastikan Access policy menyertakan email"})
			return
		}
		u, err := provision.GetOrCreateUser(c.Request.Context(), email, name, adminEmails)
		if err != nil {
			c.AbortWithStatusJSON(500, gin.H{"error": "provision user gagal"})
			return
		}
		c.Set("user", u)
		c.Next()
	}
}

// NewCFAccess: keyfunc JWKS production dari team domain Access.
func NewCFAccess(ctx context.Context, cfg config.Config, provision UserProvisioner) (gin.HandlerFunc, error) {
	jwksURL := fmt.Sprintf("https://%s/cdn-cgi/access/certs", cfg.CFTeamDomain)
	// keyfunc v3.8.2: NewRemote/NewRemoteConfig sudah dihapus — padanannya
	// NewDefaultOverrideCtx (URL tunggal) + KeyfuncCtx untuk jwt.Keyfunc.
	kfi, err := keyfunc.NewDefaultOverrideCtx(ctx, []string{jwksURL}, keyfunc.Override{
		Client:          &http.Client{Timeout: 10 * time.Second},
		RefreshInterval: time.Hour,
	})
	if err != nil {
		return nil, err
	}
	return NewCFAccessFromKeyfunc(kfi.KeyfuncCtx(ctx), cfg.CFAud, provision, cfg.AdminEmails), nil
}

// devAuthMiddleware: HANYA untuk AUTH_MODE=dev.
func devAuthMiddleware(provision UserProvisioner, adminEmails map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		email := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Dev-Email")))
		if email == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "mode dev: header X-Dev-Email wajib"})
			return
		}
		u, err := provision.GetOrCreateUser(c.Request.Context(), email, email, adminEmails)
		if err != nil {
			c.AbortWithStatusJSON(500, gin.H{"error": "provision user gagal"})
			return
		}
		c.Set("user", u)
		c.Next()
	}
}
