// Package calculator implements the arithmetic core of the service.
//
// It is deliberately free of any transport concern (HTTP, JSON): callers hand
// it an operation and its operands and get back a result or a typed error.
// That keeps the business rules trivially unit-testable and reusable from any
// future entry point (CLI, gRPC, ...).
package calculator

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

// Operation identifies an arithmetic operation supported by the calculator.
type Operation string

// Supported operations.
const (
	Add        Operation = "add"
	Subtract   Operation = "subtract"
	Multiply   Operation = "multiply"
	Divide     Operation = "divide"
	Power      Operation = "power"
	Sqrt       Operation = "sqrt"
	Percentage Operation = "percentage"
)

// Sentinel errors returned by Calculate. Callers should match them with
// errors.Is, since they may be wrapped with additional context.
var (
	// ErrUnknownOperation means the requested operation is not supported.
	ErrUnknownOperation = errors.New("unknown operation")
	// ErrDivisionByZero means the divisor of a division was zero.
	ErrDivisionByZero = errors.New("division by zero")
	// ErrNegativeSqrt means a square root of a negative number was requested.
	ErrNegativeSqrt = errors.New("square root of a negative number")
	// ErrInvalidOperand means an operand was NaN or infinite.
	ErrInvalidOperand = errors.New("operand must be a finite number")
	// ErrResultOutOfRange means the result is undefined or does not fit in a
	// float64 (for example an overflow, or a fractional power of a negative
	// base).
	ErrResultOutOfRange = errors.New("result is undefined or out of range")
)

// spec describes how a single operation behaves.
type spec struct {
	// arity is the number of operands the operation consumes (1 or 2).
	arity int
	// apply computes the result. For unary operations b is ignored.
	apply func(a, b float64) (float64, error)
}

// operations is the registry of supported operations. Adding a new operation
// is a matter of adding one entry here; nothing else in the package changes.
var operations = map[Operation]spec{
	Add:      {arity: 2, apply: func(a, b float64) (float64, error) { return a + b, nil }},
	Subtract: {arity: 2, apply: func(a, b float64) (float64, error) { return a - b, nil }},
	Multiply: {arity: 2, apply: func(a, b float64) (float64, error) { return a * b, nil }},
	Divide: {arity: 2, apply: func(a, b float64) (float64, error) {
		if b == 0 {
			return 0, ErrDivisionByZero
		}
		return a / b, nil
	}},
	Power: {arity: 2, apply: func(a, b float64) (float64, error) { return math.Pow(a, b), nil }},
	Sqrt: {arity: 1, apply: func(a, _ float64) (float64, error) {
		if a < 0 {
			return 0, ErrNegativeSqrt
		}
		return math.Sqrt(a), nil
	}},
	// Percentage answers "what is a% of b?", e.g. Percentage(10, 200) == 20.
	Percentage: {arity: 2, apply: func(a, b float64) (float64, error) { return a * b / 100, nil }},
}

// Arity reports how many operands op consumes. The boolean is false when the
// operation is not supported.
func Arity(op Operation) (int, bool) {
	s, ok := operations[op]
	return s.arity, ok
}

// Operations returns the names of all supported operations in alphabetical
// order.
func Operations() []Operation {
	ops := make([]Operation, 0, len(operations))
	for op := range operations {
		ops = append(ops, op)
	}
	sort.Slice(ops, func(i, j int) bool { return ops[i] < ops[j] })
	return ops
}

// Calculate applies op to the operands a and b and returns the result.
//
// For unary operations (see Arity) b is ignored. The returned error wraps one
// of the package's sentinel errors, so callers can branch with errors.Is.
func Calculate(op Operation, a, b float64) (float64, error) {
	s, ok := operations[op]
	if !ok {
		return 0, fmt.Errorf("%w: %q", ErrUnknownOperation, string(op))
	}

	if !isFinite(a) || (s.arity == 2 && !isFinite(b)) {
		return 0, ErrInvalidOperand
	}

	result, err := s.apply(a, b)
	if err != nil {
		return 0, err
	}

	// Finite inputs can still produce +Inf (overflow) or NaN (e.g. (-8)^(1/3)).
	// Neither is representable in JSON, so surface them as an explicit error.
	if !isFinite(result) {
		return 0, ErrResultOutOfRange
	}

	return result, nil
}

func isFinite(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}
