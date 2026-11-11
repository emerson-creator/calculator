package api

import (
	"log/slog"
	"net/http"
)

// Config holds the settings of the HTTP layer.
type Config struct {
	// AllowedOrigins lists the browser origins allowed to call the API
	// (CORS). Leave it empty when the frontend is served from the same origin.
	AllowedOrigins []string
	// StaticDir is the directory with the compiled frontend. When set, the
	// service also serves the web application, so API and UI share one
	// origin. Leave it empty to serve the API only.
	StaticDir string
}

// NewRouter builds the complete HTTP handler of the service: routes plus the
// middleware stack.
//
// Routes:
//
//	GET  /healthz              liveness probe
//	GET  /api/v1/operations    list supported operations
//	POST /api/v1/calculate     perform a single operation
//	POST /api/v1/evaluate      evaluate a full expression
//	GET  /                     the web application, if Config.StaticDir is set
func NewRouter(logger *slog.Logger, cfg Config) http.Handler {
	h := NewHandler(logger)

	mux := http.NewServeMux()
	mux.Handle("/healthz", h.method(http.MethodGet, h.Health))
	mux.Handle("/api/v1/operations", h.method(http.MethodGet, h.Operations))
	mux.Handle("/api/v1/calculate", h.method(http.MethodPost, h.Calculate))
	mux.Handle("/api/v1/evaluate", h.method(http.MethodPost, h.Evaluate))
	// Unknown API paths are always a JSON 404, never the web application.
	mux.HandleFunc("/api/", h.NotFound)
	if cfg.StaticDir != "" {
		mux.Handle("/", h.static(cfg.StaticDir))
	} else {
		mux.HandleFunc("/", h.NotFound)
	}

	// Outermost first: Logging sees the final status, including the 500
	// written by Recover.
	return Chain(mux,
		Logging(logger),
		Recover(logger),
		CORS(cfg.AllowedOrigins),
	)
}

// method restricts a handler to a single HTTP method, answering anything else
// with a JSON 405 so error responses keep one consistent shape.
func (h *Handler) method(allowed string, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != allowed {
			w.Header().Set("Allow", allowed)
			h.writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed,
				"method "+r.Method+" is not allowed on this resource; use "+allowed)
			return
		}
		next(w, r)
	})
}