// Package expression evaluates arithmetic expressions written as text, such
// as "2 * (3 + 4) ^ 2".
//
// It works in three small stages: the lexer turns text into tokens, the
// parser turns tokens into a syntax tree that encodes operator precedence,
// and the tree evaluates itself by delegating every arithmetic step to the
// calculator package.
//
// Supported syntax:
//
//   - numbers: 42, 3.14, .5, 1e3, 2.5E-4
//   - binary operators: + - * / ^
//   - unary sign: -x, +x
//   - postfix percent: x% (meaning x / 100)
//   - grouping: ( ... )
//   - functions: sqrt( ... )
//
// Implicit multiplication, as in "2(3)", is deliberately not supported.
package expression

import "unicode/utf8"

// MaxLength is the maximum number of characters accepted in an expression.
const MaxLength = 256

// Evaluate parses and evaluates an arithmetic expression.
//
// The error is ErrTooLong, a *SyntaxError (malformed input, with the offending
// position), or one of the calculator package's sentinel errors (well-formed
// input that has no answer, such as a division by zero).
func Evaluate(input string) (float64, error) {
	if utf8.RuneCountInString(input) > MaxLength {
		return 0, ErrTooLong
	}

	tokens, err := lex(input)
	if err != nil {
		return 0, err
	}
	root, err := parse(tokens)
	if err != nil {
		return 0, err
	}
	result, err := root.eval()
	if err != nil {
		return 0, err
	}

	// Normalise negative zero (e.g. from "-0") so clients never see "-0".
	if result == 0 {
		return 0, nil
	}
	return result, nil
}