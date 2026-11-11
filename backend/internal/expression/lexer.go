package expression

import (
	"math"
	"strconv"
	"unicode"
)

// tokenKind classifies a lexical token.
type tokenKind int

const (
	tokEOF tokenKind = iota
	tokNumber
	tokIdent
	tokPlus
	tokMinus
	tokStar
	tokSlash
	tokCaret
	tokPercent
	tokLParen
	tokRParen
)

// token is one lexical unit of an expression.
type token struct {
	kind tokenKind
	// pos is the zero-based character offset of the token in the input.
	pos int
	// text is the token exactly as written; empty for tokEOF.
	text string
	// value is the parsed number; only meaningful for tokNumber.
	value float64
}

// punctuation maps single-character tokens to their kind.
var punctuation = map[rune]tokenKind{
	'+': tokPlus,
	'-': tokMinus,
	'*': tokStar,
	'/': tokSlash,
	'^': tokCaret,
	'%': tokPercent,
	'(': tokLParen,
	')': tokRParen,
}

// lex splits input into tokens. The returned slice always ends with a tokEOF
// token, which lets the parser look ahead without bounds checks.
func lex(input string) ([]token, error) {
	runes := []rune(input)
	tokens := make([]token, 0, len(runes)+1)

	for i := 0; i < len(runes); {
		r := runes[i]
		switch {
		case unicode.IsSpace(r):
			i++

		case isDigit(r) || r == '.':
			tok, next, err := lexNumber(runes, i)
			if err != nil {
				return nil, err
			}
			tokens = append(tokens, tok)
			i = next

		case isLetter(r):
			start := i
			for i < len(runes) && isLetter(runes[i]) {
				i++
			}
			tokens = append(tokens, token{kind: tokIdent, pos: start, text: string(runes[start:i])})

		default:
			kind, ok := punctuation[r]
			if !ok {
				return nil, syntaxErrorf(i, "unexpected character %q", string(r))
			}
			tokens = append(tokens, token{kind: kind, pos: i, text: string(r)})
			i++
		}
	}

	return append(tokens, token{kind: tokEOF, pos: len(runes)}), nil
}

// lexNumber reads a numeric literal starting at runes[start] and returns the
// token together with the index of the first character after it.
//
// Accepted forms: 42, 3.14, .5, 5., and any of those followed by an exponent
// such as 1e3, 2.5E-4 or 1e+21 (the notation JSON uses for large results, so
// a previous answer can be fed back in).
func lexNumber(runes []rune, start int) (token, int, error) {
	i := start
	digits := 0

	for i < len(runes) && isDigit(runes[i]) {
		i++
		digits++
	}
	if i < len(runes) && runes[i] == '.' {
		i++
		for i < len(runes) && isDigit(runes[i]) {
			i++
			digits++
		}
	}
	if digits == 0 {
		return token{}, 0, syntaxErrorf(start, "invalid number %q", string(runes[start:i]))
	}

	// Only consume an exponent when it is complete; otherwise leave the "e"
	// for the caller, which will report it as an unexpected identifier.
	if i < len(runes) && (runes[i] == 'e' || runes[i] == 'E') {
		j := i + 1
		if j < len(runes) && (runes[j] == '+' || runes[j] == '-') {
			j++
		}
		if j < len(runes) && isDigit(runes[j]) {
			for j < len(runes) && isDigit(runes[j]) {
				j++
			}
			i = j
		}
	}

	// A second decimal point, as in "1.2.3", is a malformed number rather
	// than two adjacent numbers.
	if i < len(runes) && runes[i] == '.' {
		for i < len(runes) && (isDigit(runes[i]) || runes[i] == '.') {
			i++
		}
		return token{}, 0, syntaxErrorf(start, "invalid number %q", string(runes[start:i]))
	}

	text := string(runes[start:i])
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(value, 0) {
		// The literal is well-formed by construction, so the only possible
		// failure is a magnitude that does not fit in a float64.
		return token{}, 0, syntaxErrorf(start, "number %q is too large", text)
	}

	return token{kind: tokNumber, pos: start, text: text, value: value}, i, nil
}

func isDigit(r rune) bool {
	return r >= '0' && r <= '9'
}

func isLetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}
