package api

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/emerson-creator/calculator/backend/internal/expression"
)

// evaluateRequest is the body of POST /api/v1/evaluate.
//
// Expression is a pointer so a missing field can be told apart from an empty
// string, which is reported as a syntax error instead.
type evaluateRequest struct {
	Expression *string `json:"expression"`
}

// evaluateResponse is the success body of POST /api/v1/evaluate.
type evaluateResponse struct {
	Expression string  `json:"expression"`
	Result     float64 `json:"result"`
}

// Evaluate computes the value of a full arithmetic expression, honouring
// operator precedence and parentheses.
func (h *Handler) Evaluate(w http.ResponseWriter, r *http.Request) {
	if !isJSON(r.Header.Get("Content-Type")) {
		h.writeError(w, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType,
			"Content-Type must be application/json")
		return
	}

	var req evaluateRequest
	if status, code, msg, ok := decodeJSON(w, r, &req); !ok {
		h.writeError(w, status, code, msg)
		return
	}
	if req.Expression == nil {
		h.writeError(w, http.StatusBadRequest, CodeInvalidRequest, `field "expression" is required`)
		return
	}

	result, err := expression.Evaluate(*req.Expression)
	if err != nil {
		h.writeEvaluateError(w, err)
		return
	}

	h.writeJSON(w, http.StatusOK, evaluateResponse{Expression: *req.Expression, Result: result})
}

// writeEvaluateError translates an error from the expression package into a
// response. Malformed expressions are 400s (with the position of the
// problem); well-formed expressions without an answer fall through to the
// same mapping the calculate endpoint uses.
func (h *Handler) writeEvaluateError(w http.ResponseWriter, err error) {
	var syntaxErr *expression.SyntaxError

	switch {
	case errors.As(err, &syntaxErr):
		pos := syntaxErr.Pos
		h.writeJSON(w, http.StatusBadRequest, errorResponse{Error: errorBody{
			Code:     CodeSyntaxError,
			Message:  syntaxErr.Msg,
			Position: &pos,
		}})
	case errors.Is(err, expression.ErrTooLong):
		h.writeError(w, http.StatusBadRequest, CodeExpressionTooLong,
			fmt.Sprintf("expression must not exceed %d characters", expression.MaxLength))
	default:
		status, code, msg := h.mapCalculatorError(err)
		h.writeError(w, status, code, msg)
	}
}
