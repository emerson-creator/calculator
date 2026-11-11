package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	indexHTML = "<!doctype html><title>Calculator</title>"
	appJS     = "console.log('app')"
)

// newStaticRouter builds a router that serves a minimal fake frontend build.
func newStaticRouter(t *testing.T) http.Handler {
	t.Helper()

	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "index.html"), indexHTML)
	writeFile(t, filepath.Join(dir, "favicon.svg"), "<svg/>")
	writeFile(t, filepath.Join(dir, "assets", "app-abc123.js"), appJS)
	// A file next to the served directory that must stay unreachable.
	writeFile(t, filepath.Join(filepath.Dir(dir), "secret.txt"), "TOP-SECRET-CONTENT")

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRouter(logger, Config{StaticDir: dir})
}

func writeFile(t *testing.T, name, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func get(router http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestStatic_ServesIndex(t *testing.T) {
	t.Parallel()
	router := newStaticRouter(t)

	// "/" is the entry point; the next two are client-side routes that must
	// survive a page reload. "/assets" is a directory: it has no listing and
	// is treated like any other route.
	for _, target := range []string{"/", "/history", "/some/deep/route", "/assets"} {
		t.Run(target, func(t *testing.T) {
			t.Parallel()

			rec := get(router, target)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if body := rec.Body.String(); body != indexHTML {
				t.Errorf("body = %q, want index.html", body)
			}
			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
				t.Errorf("Content-Type = %q, want text/html", ct)
			}
			if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
				t.Errorf("Cache-Control = %q, want no-cache", cc)
			}
		})
	}
}

func TestStatic_ServesFiles(t *testing.T) {
	t.Parallel()
	router := newStaticRouter(t)

	t.Run("hashed asset is cached forever", func(t *testing.T) {
		t.Parallel()

		rec := get(router, "/assets/app-abc123.js")
		if rec.Code != http.StatusOK || rec.Body.String() != appJS {
			t.Fatalf("got (%d, %q), want (200, the script)", rec.Code, rec.Body.String())
		}
		if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
			t.Errorf("Cache-Control = %q, want an immutable policy", cc)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
			t.Errorf("Content-Type = %q, want JavaScript", ct)
		}
	})

	t.Run("root file is served without the immutable policy", func(t *testing.T) {
		t.Parallel()

		rec := get(router, "/favicon.svg")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if cc := rec.Header().Get("Cache-Control"); strings.Contains(cc, "immutable") {
			t.Errorf("Cache-Control = %q, must not be immutable for unhashed files", cc)
		}
	})

	t.Run("HEAD is allowed", func(t *testing.T) {
		t.Parallel()

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/", nil))
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})
}

func TestStatic_NotFound(t *testing.T) {
	t.Parallel()
	router := newStaticRouter(t)

	targets := []string{
		"/assets/missing.js", // a missing asset must not be index.html disguised as a script
		"/missing.png",
		"/api/v1/unknown", // unknown API paths never fall back to the application
		"/api/",
	}
	for _, target := range targets {
		t.Run(target, func(t *testing.T) {
			t.Parallel()
			assertError(t, get(router, target), http.StatusNotFound, CodeNotFound)
		})
	}
}

func TestStatic_CannotEscapeDirectory(t *testing.T) {
	t.Parallel()
	router := newStaticRouter(t)

	for _, target := range []string{"/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"} {
		t.Run(target, func(t *testing.T) {
			t.Parallel()

			rec := get(router, target)
			if strings.Contains(rec.Body.String(), "TOP-SECRET-CONTENT") {
				t.Fatalf("served a file outside the static directory (status %d)", rec.Code)
			}
		})
	}
}

func TestStatic_RejectsOtherMethods(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	newStaticRouter(t).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	assertError(t, rec, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Errorf("Allow header = %q, want %q", got, "GET, HEAD")
	}
}

func TestStatic_APIStillWorks(t *testing.T) {
	t.Parallel()
	router := newStaticRouter(t)

	rec := postEvaluate(t, router, "2 * (3 + 4) ^ 2")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200\nbody: %s", rec.Code, rec.Body.String())
	}
	if got := decodeBody[evaluateResponse](t, rec); got.Result != 98 {
		t.Errorf("result = %v, want 98", got.Result)
	}

	if rec := get(router, "/healthz"); rec.Code != http.StatusOK {
		t.Errorf("/healthz status = %d, want 200", rec.Code)
	}
}

func TestStatic_MissingBuildIsNotFound(t *testing.T) {
	t.Parallel()

	// STATIC_DIR points at a directory without a build: fail clearly instead
	// of serving a blank page.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := NewRouter(logger, Config{StaticDir: t.TempDir()})

	assertError(t, get(router, "/"), http.StatusNotFound, CodeNotFound)
}

func TestWithoutStaticDir_RootIsNotFound(t *testing.T) {
	t.Parallel()
	assertError(t, get(newTestRouter(t), "/"), http.StatusNotFound, CodeNotFound)
}