// Package api exposes the calculator over HTTP as a small JSON REST API.
//
// It owns everything transport-related: decoding and validating requests,
// translating domain errors into HTTP status codes, and encoding responses.
// The arithmetic itself lives in the calculator package.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/emerson-creator/calculator/backend/internal/calculator"
)

// maxBodyBytes caps the size of a request body. A calculation request is a
// few dozen bytes, so anything close to this limit is not a legitimate call.
const maxBodyBytes = 1 << 10 // 1 KiB

// Machine-readable error codes returned in the "error.code" field. Clients
// should branch on these rather than on the human-readable message.
const (
	CodeInvalidRequest       = "INVALID_REQUEST"
	CodeUnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE"
	CodePayloadTooLarge      = "PAYLOAD_TOO_LARGE"
	CodeMissingOperand       = "MISSING_OPERAND"
	CodeUnknownOperation     = "UNKNOWN_OPERATION"
	CodeInvalidOperand       = "INVALID_OPERAND"
	CodeDivisionByZero       = "DIVISION_BY_ZERO"
	CodeNegativeSqrt         = "NEGATIVE_SQRT"
	CodeResultOutOfRange     = "RESULT_OUT_OF_RANGE"
	CodeMethodNotAllowed     = "METHOD_NOT_ALLOWED"
	CodeNotFound             = "NOT_FOUND"
	CodeInternal             = "INTERNAL_ERROR"
)

// calculateRequest is the body of POST /api/v1/calculate.
//
// Operands are pointers so a missing operand can be told apart from an
// explicit zero.
type calculateRequest struct {
	Operation string   `json:"operation"`
	A         *float64 `json:"a"`
	B         *float64 `json:"b"`
}

// calculateResponse is the success body of POST /api/v1/calculate.
type calculateResponse struct {
	Operation string  `json:"operation"`
	Result    float64 `json:"result"`
}

// operationInfo describes one supported operation.
type operationInfo struct {
	Name     string `json:"name"`
	Operands int    `json:"operands"`
}

// operationsResponse is the body of GET /api/v1/operations.
type operationsResponse struct {
	Operations []operationInfo `json:"operations"`
}

// errorResponse is the body of every non-2xx response.
type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Handler holds the HTTP handlers of the API and their dependencies.
type Handler struct {
	logger *slog.Logger
}

// NewHandler returns a Handler that logs through logger.
func NewHandler(logger *slog.Logger) *Handler {
	return &Handler{logger: logger}
}

// Health reports that the process is up. It is meant for liveness probes.
func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Operations lists the supported operations and how many operands each takes.
func (h *Handler) Operations(w http.ResponseWriter, _ *http.Request) {
	ops := calculator.Operations()
	resp := operationsResponse{Operations: make([]operationInfo, 0, len(ops))}
	for _, op := range ops {
		arity, _ := calculator.Arity(op)
		resp.Operations = append(resp.Operations, operationInfo{Name: string(op), Operands: arity})
	}
	h.writeJSON(w, http.StatusOK, resp)
}

// Calculate performs a single arithmetic operation.
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	if !isJSON(r.Header.Get("Content-Type")) {
		h.writeError(w, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType,
			"Content-Type must be application/json")
		return
	}

	var req calculateRequest
	if status, code, msg, ok := decodeJSON(w, r, &req); !ok {
		h.writeError(w, status, code, msg)
		return
	}

	if req.Operation == "" {
		h.writeError(w, http.StatusBadRequest, CodeInvalidRequest, `field "operation" is required`)
		return
	}

	op := calculator.Operation(req.Operation)
	arity, ok := calculator.Arity(op)
	if !ok {
		h.writeError(w, http.StatusBadRequest, CodeUnknownOperation,
			fmt.Sprintf("unknown operation %q; supported operations: %s", req.Operation, supportedOperations()))
		return
	}

	if req.A == nil {
		h.writeError(w, http.StatusBadRequest, CodeMissingOperand, `operand "a" is required`)
		return
	}
	var b float64
	if arity == 2 {
		if req.B == nil {
			h.writeError(w, http.StatusBadRequest, CodeMissingOperand,
				fmt.Sprintf(`operand "b" is required for operation %q`, req.Operation))
			return
		}
		b = *req.B
	}

	result, err := calculator.Calculate(op, *req.A, b)
	if err != nil {
		status, code, msg := h.mapCalculatorError(err)
		h.writeError(w, status, code, msg)
		return
	}

	h.writeJSON(w, http.StatusOK, calculateResponse{Operation: req.Operation, Result: result})
}

// NotFound is the JSON fallback for unknown routes.
func (h *Handler) NotFound(w http.ResponseWriter, _ *http.Request) {
	h.writeError(w, http.StatusNotFound, CodeNotFound, "resource not found")
}

// mapCalculatorError translates a domain error into an HTTP status, an error
// code and a client-facing message.
//
// Semantically invalid math (the request was well-formed, but the operation
// has no answer) maps to 422; anything unexpected is a 500 and is logged.
func (h *Handler) mapCalculatorError(err error) (status int, code, message string) {
	switch {
	case errors.Is(err, calculator.ErrDivisionByZero):
		return http.StatusUnprocessableEntity, CodeDivisionByZero, "cannot divide by zero"
	case errors.Is(err, calculator.ErrNegativeSqrt):
		return http.StatusUnprocessableEntity, CodeNegativeSqrt,
			"cannot take the square root of a negative number"
	case errors.Is(err, calculator.ErrResultOutOfRange):
		return http.StatusUnprocessableEntity, CodeResultOutOfRange,
			"the result is undefined or too large to represent"
	case errors.Is(err, calculator.ErrInvalidOperand):
		return http.StatusBadRequest, CodeInvalidOperand, "operands must be finite numbers"
	case errors.Is(err, calculator.ErrUnknownOperation):
		return http.StatusBadRequest, CodeUnknownOperation, err.Error()
	default:
		h.logger.Error("unexpected calculator error", "error", err)
		return http.StatusInternalServerError, CodeInternal, "internal server error"
	}
}

// decodeJSON strictly decodes the request body into dst. On failure ok is
// false and the remaining values describe the error response to send.
//
// "Strictly" means: bounded size, no unknown fields, and exactly one JSON
// value in the body.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) (status int, code, message string, ok bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		return describeDecodeError(err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return describeDecodeError(err)
		}
		return http.StatusBadRequest, CodeInvalidRequest,
			"request body must contain a single JSON object", false
	}
	return 0, "", "", true
}

func describeDecodeError(err error) (status int, code, message string, ok bool) {
	var (
		tooLarge  *http.MaxBytesError
		typeErr   *json.UnmarshalTypeError
		syntaxErr *json.SyntaxError
	)
	switch {
	case errors.As(err, &tooLarge):
		return http.StatusRequestEntityTooLarge, CodePayloadTooLarge,
			fmt.Sprintf("request body must not exceed %d bytes", maxBodyBytes), false
	case errors.As(err, &typeErr):
		return http.StatusBadRequest, CodeInvalidRequest,
			fmt.Sprintf("field %q has an invalid value: operation must be a string and operands must be numbers", typeErr.Field), false
	case errors.Is(err, io.EOF):
		return http.StatusBadRequest, CodeInvalidRequest, "request body must not be empty", false
	case errors.As(err, &syntaxErr), errors.Is(err, io.ErrUnexpectedEOF):
		return http.StatusBadRequest, CodeInvalidRequest, "request body is not valid JSON", false
	case strings.HasPrefix(err.Error(), "json: unknown field "):
		// encoding/json exposes no typed error for unknown fields.
		field := strings.TrimPrefix(err.Error(), "json: unknown field ")
		return http.StatusBadRequest, CodeInvalidRequest, "unknown field " + field, false
	default:
		return http.StatusBadRequest, CodeInvalidRequest, "request body is not valid JSON", false
	}
}

func isJSON(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	return err == nil && mediaType == "application/json"
}

func supportedOperations() string {
	ops := calculator.Operations()
	names := make([]string, len(ops))
	for i, op := range ops {
		names[i] = string(op)
	}
	return strings.Join(names, ", ")
}

func (h *Handler) writeError(w http.ResponseWriter, status int, code, message string) {
	h.writeJSON(w, status, errorResponse{Error: errorBody{Code: code, Message: message}})
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		h.logger.Error("failed to write response", "error", err)
	}
}