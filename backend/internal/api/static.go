package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// static serves the compiled frontend (a single-page application) from dir.
//
//   - A request for an existing file gets that file.
//   - Any other path without a file extension gets index.html, so client-side
//     routes survive a page reload.
//   - A missing asset (a path with an extension) is a JSON 404, which is far
//     easier to diagnose than an HTML page served as JavaScript.
func (h *Handler) static(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	index := filepath.Join(dir, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			h.writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed,
				"method "+r.Method+" is not allowed on this resource; use GET")
			return
		}

		// path.Clean on a rooted path removes any ".." element, so the
		// request cannot escape dir.
		clean := path.Clean("/" + r.URL.Path)

		if clean != "/" && isFile(filepath.Join(dir, filepath.FromSlash(clean))) {
			// Vite puts a content hash in the name of everything under
			// /assets/, so those files can be cached forever.
			if strings.HasPrefix(clean, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}

		if path.Ext(clean) != "" || !isFile(index) {
			h.NotFound(w, r)
			return
		}

		// index.html names the current asset files, so it must always be
		// revalidated or users would keep an old version after a deploy.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}

func isFile(name string) bool {
	info, err := os.Stat(name)
	return err == nil && info.Mode().IsRegular()
}