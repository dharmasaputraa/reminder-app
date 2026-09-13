package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// spaFS is the source of SPA files. It defaults to webRoot (the embedded
// output of `make web`); tests swap it with an empty/fake FS so results do
// not depend on whether a build exists in internal/api/webroot.
var spaFS fs.FS = webRoot

// spaHandler serves the static files from `make web` (embedded). Unknown paths
// → index.html (client-side routing). Not built yet → 503 with a clear message.
func (s *Server) spaHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") || c.Request.URL.Path == "/metrics" {
			c.JSON(http.StatusNotFound, gin.H{"error": "endpoint not found"})
			return
		}
		rel := strings.TrimPrefix(path.Clean("/"+c.Request.URL.Path), "/")
		if rel == "" || rel == "." {
			rel = "index.html"
		}
		if info, err := fs.Stat(spaFS, "webroot/"+rel); err == nil && !info.IsDir() && rel != "index.html" {
			if path.Ext(rel) == ".webmanifest" {
				// Go's mime package does not know .webmanifest → without this it is served as text/plain.
				c.Header("Content-Type", "application/manifest+json")
			}
			c.FileFromFS("webroot/"+rel, http.FS(spaFS))
			return
		}
		// index.html is read manually: http.FileServer issues a 301 redirect
		// for paths ending in /index.html, which breaks the SPA fallback.
		b, err := fs.ReadFile(spaFS, "webroot/index.html")
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SPA not built — run 'make web'"})
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", b)
	}
}
