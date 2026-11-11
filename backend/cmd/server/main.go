// Command server runs the calculator HTTP API.
//
// Configuration is read from environment variables:
//
//	PORT                  port to listen on (default "8080")
//	CORS_ALLOWED_ORIGINS  comma-separated list of browser origins allowed to
//	                      call the API (default "http://localhost:5173", the
//	                      Vite dev server). Set it to an empty string to
//	                      disable CORS.
//	STATIC_DIR            directory with the compiled frontend. When set, the
//	                      server also serves the web application (this is how
//	                      the Docker image runs). Unset by default.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/emerson-creator/calculator/backend/internal/api"
)

const (
	defaultPort           = "8080"
	defaultAllowedOrigins = "http://localhost:5173"
	shutdownTimeout       = 10 * time.Second
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	port := envOr("PORT", defaultPort)
	origins := splitAndTrim(envOr("CORS_ALLOWED_ORIGINS", defaultAllowedOrigins))
	staticDir := os.Getenv("STATIC_DIR")

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: api.NewRouter(logger, api.Config{AllowedOrigins: origins, StaticDir: staticDir}),
		// Timeouts protect the server from slow or stalled clients.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Stop accepting work on Ctrl+C or SIGTERM (what Docker/Kubernetes send).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("server listening",
			"addr", srv.Addr, "cors_allowed_origins", origins, "static_dir", staticDir)
		serverErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining in-flight requests")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info("server stopped cleanly")
	return nil
}

// envOr returns the value of the environment variable key, or fallback when
// it is unset. An explicitly empty value is respected.
func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

// splitAndTrim splits a comma-separated list, dropping empty entries.
func splitAndTrim(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}