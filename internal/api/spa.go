package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// spaFS adalah sumber file SPA. Default-nya webRoot (hasil `make web` yang
// di-embed); test menukarnya dengan FS kosong/palsu agar hasilnya tidak
// bergantung pada ada/tidaknya build di internal/api/webroot.
var spaFS fs.FS = webRoot

// spaHandler: layani file statis hasil `make web` (di-embed). Path tak dikenal
// → index.html (client-side routing). Belum di-build → 503 dengan pesan jelas.
func (s *Server) spaHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") || c.Request.URL.Path == "/metrics" {
			c.JSON(http.StatusNotFound, gin.H{"error": "endpoint tidak ditemukan"})
			return
		}
		rel := strings.TrimPrefix(path.Clean("/"+c.Request.URL.Path), "/")
		if rel == "" || rel == "." {
			rel = "index.html"
		}
		if info, err := fs.Stat(spaFS, "webroot/"+rel); err == nil && !info.IsDir() && rel != "index.html" {
			if path.Ext(rel) == ".webmanifest" {
				// mime Go tidak mengenal .webmanifest → tanpa ini tersaji text/plain.
				c.Header("Content-Type", "application/manifest+json")
			}
			c.FileFromFS("webroot/"+rel, http.FS(spaFS))
			return
		}
		// index.html dibaca manual: http.FileServer melakukan redirect 301
		// untuk path berakhiran /index.html sehingga merusak fallback SPA.
		b, err := fs.ReadFile(spaFS, "webroot/index.html")
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SPA belum di-build — jalankan 'make web'"})
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", b)
	}
}
