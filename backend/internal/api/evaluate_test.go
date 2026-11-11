package api

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/emerson-creator/calculator/backend/internal/expression"
)

// postEvaluate sends expr to POST /api/v1/evaluate wrapped in a JSON body.
func postEvaluate(t *testing.T, router http.Handler, expr string) *httptest.ResponseRecorder {
	t.Helper()
	return postEvaluateRaw(t, router, `{"expression":`+strconv.Quote(expr)+`}`)
}

func postEvaluateRaw(t *testing.T, router http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/evaluate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestEvaluate_Success(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		expr string
		want float64
	}{
		{expr: "2 + 3", want: 5},
		{expr: "2 + 3 * 4", want: 14},
		{expr: "(2 + 3) * 4", want: 20},
		{expr: "2 * (3 + 4) ^ 2", want: 98},
		{expr: "-2 ^ 2", want: -4},
		{expr: "10% * 200", want: 20},
		{expr: "sqrt(16) + 1", want: 5},
		{expr: "  7  ", want: 7},
	}

	for _, tt := range tests {
		t.Run(tt.expr, func(t *testing.T) {
			t.Parallel()

			rec := postEvaluate(t, router, tt.expr)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200\nbody: %s", rec.Code, rec.Body.String())
			}
			got := decodeBody[evaluateResponse](t, rec)
			if math.Abs(got.Result-tt.want) > 1e-9 {
				t.Errorf("result = %v, want %v", got.Result, tt.want)
			}
			if got.Expression != tt.expr {
				t.Errorf("echoed expression = %q, want %q", got.Expression, tt.expr)
			}
		})
	}
}

func TestEvaluate_SyntaxErrors(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		name    string
		expr    string
		wantPos int
	}{
		{name: "empty expression", expr: "", wantPos: 0},
		{name: "trailing operator", expr: "2 +", wantPos: 3},
		{name: "unclosed parenthesis", expr: "(2 + 3", wantPos: 6},
		{name: "unexpected closing parenthesis", expr: "2 + 3)", wantPos: 5},
		{name: "invalid character", expr: "2 $ 3", wantPos: 2},
		{name: "unknown function", expr: "cos(0)", wantPos: 0},
		{name: "implicit multiplication", expr: "2(3)", wantPos: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := postEvaluate(t, router, tt.expr)
			assertError(t, rec, http.StatusBadRequest, CodeSyntaxError)

			got := decodeBody[errorResponse](t, rec)
			if got.Error.Position == nil {
				t.Fatal("syntax error response has no position")
			}
			if *got.Error.Position != tt.wantPos {
				t.Errorf("position = %d, want %d (message: %q)", *got.Error.Position, tt.wantPos, got.Error.Message)
			}
		})
	}
}

func TestEvaluate_MathErrors(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		name     string
		expr     string
		wantCode string
	}{
		{name: "division by zero", expr: "10 / (5 - 5)", wantCode: CodeDivisionByZero},
		{name: "sqrt of negative", expr: "sqrt(2 - 6)", wantCode: CodeNegativeSqrt},
		{name: "overflow", expr: "10 ^ 400", wantCode: CodeResultOutOfRange},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := postEvaluate(t, router, tt.expr)
			assertError(t, rec, http.StatusUnprocessableEntity, tt.wantCode)

			// Position only makes sense for syntax errors.
			if strings.Contains(rec.Body.String(), `"position"`) {
				t.Errorf("math error response contains a position: %s", rec.Body.String())
			}
		})
	}
}

func TestEvaluate_InvalidRequests(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{name: "empty body", body: ``, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "malformed JSON", body: `{"expression":`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "missing expression", body: `{}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "null expression", body: `{"expression":null}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "expression as number", body: `{"expression":42}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{name: "unknown field", body: `{"expression":"1+1","precision":2}`, wantStatus: 400, wantCode: CodeInvalidRequest},
		{
			name:       "expression too long",
			body:       `{"expression":"` + strings.Repeat("1", expression.MaxLength+1) + `"}`,
			wantStatus: 400, wantCode: CodeExpressionTooLong,
		},
		{
			name:       "body too large",
			body:       `{"expression":"` + strings.Repeat("1", maxBodyBytes) + `"}`,
			wantStatus: 413, wantCode: CodePayloadTooLarge,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assertError(t, postEvaluateRaw(t, router, tt.body), tt.wantStatus, tt.wantCode)
		})
	}
}

func TestEvaluate_ContentTypeAndMethod(t *testing.T) {
	t.Parallel()
	router := newTestRouter(t)

	t.Run("wrong content type", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/evaluate", strings.NewReader(`{"expression":"1+1"}`))
		req.Header.Set("Content-Type", "text/plain")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assertError(t, rec, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType)
	})

	t.Run("wrong method", func(t *testing.T) {
		t.Parallel()

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/evaluate", nil))

		assertError(t, rec, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
		if got := rec.Header().Get("Allow"); got != http.MethodPost {
			t.Errorf("Allow header = %q, want POST", got)
		}
	})
}

// TestCalculate_ErrorsHaveNoPosition guards the existing endpoint's contract:
// adding the optional position field must not change its responses.
func TestCalculate_ErrorsHaveNoPosition(t *testing.T) {
	t.Parallel()

	rec := postCalculate(t, newTestRouter(t), `{"operation":"divide","a":1,"b":0}`)
	if strings.Contains(rec.Body.String(), `"position"`) {
		t.Errorf("calculate error response contains a position: %s", rec.Body.String())
	}
}