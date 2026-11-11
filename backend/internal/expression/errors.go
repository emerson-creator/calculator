package expression

import (
	"errors"
	"fmt"
)

// ErrTooLong is returned when an expression exceeds MaxLength characters.
var ErrTooLong = errors.New("expression is too long")

// SyntaxError reports that an expression is not well-formed.
type SyntaxError struct {
	// Pos is the zero-based character offset in the input at which the
	// problem was detected. For errors found at the end of the input it
	// equals the input's length.
	Pos int
	// Msg describes the problem without mentioning the position.
	Msg string
}

func (e *SyntaxError) Error() string {
	return fmt.Sprintf("syntax error at position %d: %s", e.Pos, e.Msg)
}

func syntaxErrorf(pos int, format string, args ...any) *SyntaxError {
	return &SyntaxError{Pos: pos, Msg: fmt.Sprintf(format, args...)}
}
