package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestRouter builds the real router (routes + middleware) with logs
// discarded, so tests exercise the same stack as production.
func newTestRouter(t *testing.T, origins ...string) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRouter(logger, Config{AllowedOrigins: origins})
}

// postCalculate sends body to POST /api/v1/calculate as JSON.
func postCalculate(t *testing.T, router http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("response is not valid JSON: %v\nbody: %s", err, rec.Body.String())
	}
	return v
}

func assertError(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d\nbody: %s", rec.Code, wantStatus, rec.Body.String())
	}
	got := decodeBody[errorResponse](t, rec)
	if got.Error.Code != wantCode {
		t.Errorf("error code = %q, want %q", got.Error.Code, wantCode)
	}
	if got.Error.Message == "" {
		t.Error("error message is empty, want a human-readable explanation")
	}
}

func TestCalculate_Success(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		name string
		body string
		want float64
	}{
		{name: "add", body: `{"operation":"add","a":2,"b":3}`, want: 5},
		{name: "subtract", body: `{"operation":"subtract","a":2,"b":3}`, want: -1},
		{name: "multiply", body: `{"operation":"multiply","a":4,"b":2.5}`, want: 10},
		{name: "divide", body: `{"operation":"divide","a":10,"b":4}`, want: 2.5},
		{name: "power", body: `{"operation":"power","a":2,"b":8}`, want: 256},
		{name: "percentage", body: `{"operation":"percentage","a":10,"b":200}`, want: 20},
		{name: "sqrt without b", body: `{"operation":"sqrt","a":81}`, want: 9},
		{name: "sqrt ignores b", body: `{"operation":"sqrt","a":81,"b":5}`, want: 9},
		{name: "explicit zero operands are not missing", body: `{"operation":"add","a":0,"b":0}`, want: 0},
		{name: "negative and exponent notation", body: `{"operation":"add","a":-1.5e2,"b":50}`, want: -100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := postCalculate(t, router, tt.body)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200\nbody: %s", rec.Code, rec.Body.String())
			}
			got := decodeBody[calculateResponse](t, rec)
			if math.Abs(got.Result-tt.want) > 1e-9 {
				t.Errorf("result = %v, want %v", got.Result, tt.want)
			}
			if got.Operation == "" {
				t.Error("response does not echo the operation")
			}
		})
	}
}

func TestCalculate_Errors(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		// Malformed requests -> 400
		{name: "empty body", body: ``, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "malformed JSON", body: `{"operation":`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "not an object", body: `[1,2,3]`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "operand as string", body: `{"operation":"add","a":"2","b":3}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "operation as number", body: `{"operation":1,"a":2,"b":3}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "operand too large for float64", body: `{"operation":"add","a":1e999,"b":3}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "unknown field", body: `{"operation":"add","a":2,"b":3,"c":4}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "trailing data", body: `{"operation":"add","a":2,"b":3}{"x":1}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "missing operation", body: `{"a":2,"b":3}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "unknown operation", body: `{"operation":"modulo","a":2,"b":3}`, wantStatus: 400, wantCode: CodeUnknownOperation},
		{name: "missing a", body: `{"operation":"add","b":3}`, wantStatus: 400, wantCode: CodeMissingOperand},
		{name: "missing b", body: `{"operation":"add","a":2}`, wantStatus: 400, wantCode: CodeMissingOperand},
		{name: "null operand", body: `{"operation":"add","a":null,"b":3}`, wantStatus: 400, wantCode: CodeMissingOperand},
		{name: "missing a on unary", body: `{"operation":"sqrt"}`, wantStatus: 400, wantCode: CodeMissingOperand},

		// Well-formed but mathematically invalid -> 422
		{name: "division by zero", body: `{"operation":"divide","a":1,"b":0}`, wantStatus: 422, wantCode: CodeDivisionByZero},
		{name: "sqrt of negative", body: `{"operation":"sqrt","a":-9}`, wantStatus: 422, wantCode: CodeNegativeSqrt},
		{name: "overflow", body: `{"operation":"power","a":10,"b":400}`, wantStatus: 422, wantCode: CodeResultOutOfRange},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assertError(t, postCalculate(t, router, tt.body), tt.wantStatus, tt.wantCode)
		})
	}
}

func TestCalculate_UnknownOperationListsSupportedOnes(t *testing.T) {
	t.Parallel()

	rec := postCalculate(t, newTestRouter(t), `{"operation":"modulo","a":2,"b":3}`)
	got := decodeBody[errorResponse](t, rec)

	for _, op := range []string{"add", "divide", "sqrt"} {
		if !strings.Contains(got.Error.Message, op) {
			t.Errorf("message %q does not mention supported operation %q", got.Error.Message, op)
		}
	}
}

func TestCalculate_ContentType(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		name        string
		contentType string
		wantStatus  int
	}{
		{name: "json", contentType: "application/json", wantStatus: 200},
		{name: "json with charset", contentType: "application/json; charset=utf-8", wantStatus: 200},
		{name: "missing", contentType: "", wantStatus: 415},
		{name: "plain text", contentType: "text/plain", wantStatus: 415},
		{name: "form", contentType: "application/x-www-form-urlencoded", wantStatus: 415},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate",
				strings.NewReader(`{"operation":"add","a":1,"b":2}`))
			if tt.contentType != "" {
				req.Header.Set("Content-Type", tt.contentType)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d\nbody: %s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantStatus == http.StatusUnsupportedMediaType {
				assertError(t, rec, tt.wantStatus, CodeUnsupportedMediaType)
			}
		})
	}
}

func TestCalculate_BodyTooLarge(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		body string
	}{
		{name: "oversized value", body: `{"operation":"` + strings.Repeat("x", maxBodyBytes) + `","a":1,"b":2}`},
		{name: "oversized trailing whitespace", body: `{"operation":"add","a":1,"b":2}` + strings.Repeat(" ", maxBodyBytes)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := postCalculate(t, newTestRouter(t), tt.body)
			assertError(t, rec, http.StatusRequestEntityTooLarge, CodePayloadTooLarge)
		})
	}
}

func TestMethodNotAllowed(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		method, path, wantAllow string
	}{
		{method: http.MethodGet, path: "/api/v1/calculate", wantAllow: http.MethodPost},
		{method: http.MethodPut, path: "/api/v1/calculate", wantAllow: http.MethodPost},
		{method: http.MethodDelete, path: "/api/v1/calculate", wantAllow: http.MethodPost},
		{method: http.MethodPost, path: "/api/v1/operations", wantAllow: http.MethodGet},
		{method: http.MethodPost, path: "/healthz", wantAllow: http.MethodGet},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))

			assertError(t, rec, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow header = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}

func TestNotFound(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	for _, path := range []string{"/", "/api/v1/unknown", "/api/v2/calculate"} {
		t.Run(path, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			assertError(t, rec, http.StatusNotFound, CodeNotFound)
		})
	}
}

func TestHealth(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	newTestRouter(t).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := decodeBody[map[string]string](t, rec); got["status"] != "ok" {
		t.Errorf(`status field = %q, want "ok"`, got["status"])
	}
}

func TestOperations(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	newTestRouter(t).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/operations", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	got := decodeBody[operationsResponse](t, rec)
	operands := make(map[string]int, len(got.Operations))
	for _, op := range got.Operations {
		operands[op.Name] = op.Operands
	}

	want := map[string]int{
		"add": 2, "subtract": 2, "multiply": 2, "divide": 2,
		"power": 2, "percentage": 2, "sqrt": 1,
	}
	if len(operands) != len(want) {
		t.Fatalf("got %d operations, want %d: %v", len(operands), len(want), operands)
	}
	for name, n := range want {
		if operands[name] != n {
			t.Errorf("operation %q takes %d operands, want %d", name, operands[name], n)
		}
	}
}
