package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/emerson-creator/calculator/backend/internal/calculator"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestChain_OrdersMiddlewaresOutermostFirst(t *testing.T) {
	t.Parallel()

	var calls []string
	tag := func(name string) Middleware {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls = append(calls, name)
				next.ServeHTTP(w, r)
			})
		}
	}
	final := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls = append(calls, "handler")
	})

	Chain(final, tag("first"), tag("second")).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	if got, want := strings.Join(calls, ","), "first,second,handler"; got != want {
		t.Errorf("call order = %s, want %s", got, want)
	}
}

func TestLogging_RecordsRequestDetails(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	handler := Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("hello"))
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/some/path", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("log line is not valid JSON: %v\n%s", err, buf.String())
	}

	want := map[string]any{
		"method": "POST",
		"path":   "/some/path",
		"status": float64(http.StatusTeapot),
		"bytes":  float64(5),
	}
	for key, value := range want {
		if entry[key] != value {
			t.Errorf("log field %q = %v, want %v", key, entry[key], value)
		}
	}
	if _, ok := entry["duration_ms"]; !ok {
		t.Error("log line has no duration_ms field")
	}
}

func TestLogging_DefaultsToStatus200(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	// The handler writes a body without calling WriteHeader explicitly.
	handler := Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("log line is not valid JSON: %v", err)
	}
	if entry["status"] != float64(http.StatusOK) {
		t.Errorf("logged status = %v, want 200", entry["status"])
	}
}

func TestStatusRecorder_Unwrap(t *testing.T) {
	t.Parallel()

	inner := httptest.NewRecorder()
	rec := &statusRecorder{ResponseWriter: inner}
	if rec.Unwrap() != inner {
		t.Error("Unwrap() did not return the wrapped ResponseWriter")
	}
}

func TestRecover_TurnsPanicInto500(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	handler := Recover(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assertError(t, rec, http.StatusInternalServerError, CodeInternal)

	// The panic value must reach the logs but never the client.
	if !strings.Contains(buf.String(), "boom") {
		t.Error("panic value was not logged")
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Error("panic value leaked into the response body")
	}
}

func TestCORS(t *testing.T) {
	t.Parallel()

	const allowed = "http://localhost:5173"

	tests := []struct {
		name            string
		allowedOrigins  []string
		method          string
		origin          string
		preflight       bool
		wantStatus      int
		wantAllowOrigin string
		wantNextCalled  bool
	}{
		{
			name:           "allowed origin on a simple request",
			allowedOrigins: []string{allowed}, method: http.MethodPost, origin: allowed,
			wantStatus: 200, wantAllowOrigin: allowed, wantNextCalled: true,
		},
		{
			name:           "disallowed origin gets no CORS headers",
			allowedOrigins: []string{allowed}, method: http.MethodPost, origin: "http://evil.example",
			wantStatus: 200, wantAllowOrigin: "", wantNextCalled: true,
		},
		{
			name:           "request without Origin header",
			allowedOrigins: []string{allowed}, method: http.MethodGet, origin: "",
			wantStatus: 200, wantAllowOrigin: "", wantNextCalled: true,
		},
		{
			name:           "wildcard allows any origin",
			allowedOrigins: []string{"*"}, method: http.MethodGet, origin: "http://anything.example",
			wantStatus: 200, wantAllowOrigin: "*", wantNextCalled: true,
		},
		{
			name:           "no configured origins disables CORS",
			allowedOrigins: nil, method: http.MethodGet, origin: allowed,
			wantStatus: 200, wantAllowOrigin: "", wantNextCalled: true,
		},
		{
			name:           "preflight from allowed origin is answered directly",
			allowedOrigins: []string{allowed}, method: http.MethodOptions, origin: allowed, preflight: true,
			wantStatus: 204, wantAllowOrigin: allowed, wantNextCalled: false,
		},
		{
			name:           "preflight from disallowed origin gets no CORS headers",
			allowedOrigins: []string{allowed}, method: http.MethodOptions, origin: "http://evil.example", preflight: true,
			wantStatus: 204, wantAllowOrigin: "", wantNextCalled: false,
		},
		{
			name:           "plain OPTIONS is not a preflight",
			allowedOrigins: []string{allowed}, method: http.MethodOptions, origin: allowed,
			wantStatus: 200, wantAllowOrigin: allowed, wantNextCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			nextCalled := false
			handler := CORS(tt.allowedOrigins)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(tt.method, "/api/v1/calculate", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.preflight {
				req.Header.Set("Access-Control-Request-Method", http.MethodPost)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tt.wantAllowOrigin {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, tt.wantAllowOrigin)
			}
			if nextCalled != tt.wantNextCalled {
				t.Errorf("next handler called = %t, want %t", nextCalled, tt.wantNextCalled)
			}

			wantPreflightHeaders := tt.preflight && tt.wantAllowOrigin != ""
			gotPreflightHeaders := rec.Header().Get("Access-Control-Allow-Methods") != "" &&
				rec.Header().Get("Access-Control-Allow-Headers") != ""
			if gotPreflightHeaders != wantPreflightHeaders {
				t.Errorf("preflight headers present = %t, want %t", gotPreflightHeaders, wantPreflightHeaders)
			}
		})
	}
}

// TestRouter_CORSPreflight checks the middleware is actually wired into the
// router: a browser preflight must succeed before the method check runs.
func TestRouter_CORSPreflight(t *testing.T) {
	t.Parallel()

	const origin = "http://localhost:5173"
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/calculate", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := httptest.NewRecorder()

	newTestRouter(t, origin).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, origin)
	}
}

func TestMapCalculatorError(t *testing.T) {
	t.Parallel()

	h := NewHandler(discardLogger())

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "division by zero", err: calculator.ErrDivisionByZero, wantStatus: 422, wantCode: CodeDivisionByZero},
		{name: "negative sqrt", err: calculator.ErrNegativeSqrt, wantStatus: 422, wantCode: CodeNegativeSqrt},
		{name: "out of range", err: calculator.ErrResultOutOfRange, wantStatus: 422, wantCode: CodeResultOutOfRange},
		{name: "invalid operand", err: calculator.ErrInvalidOperand, wantStatus: 400, wantCode: CodeInvalidOperand},
		{name: "unknown operation", err: calculator.ErrUnknownOperation, wantStatus: 400, wantCode: CodeUnknownOperation},
		{name: "unexpected error", err: errors.New("disk on fire"), wantStatus: 500, wantCode: CodeInternal},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			status, code, msg := h.mapCalculatorError(tt.err)
			if status != tt.wantStatus || code != tt.wantCode {
				t.Errorf("got (%d, %q), want (%d, %q)", status, code, tt.wantStatus, tt.wantCode)
			}
			if tt.wantStatus == 500 && strings.Contains(msg, "disk on fire") {
				t.Error("internal error details leaked into the client message")
			}
		})
	}
}