package expression

import (
	"errors"
	"math"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/emerson-creator/calculator/backend/internal/calculator"
)

const epsilon = 1e-9

func TestEvaluate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  float64
	}{
		// Literals
		{name: "integer", input: "42", want: 42},
		{name: "decimal", input: "3.14", want: 3.14},
		{name: "leading decimal point", input: ".5", want: 0.5},
		{name: "trailing decimal point", input: "5.", want: 5},
		{name: "exponent notation", input: "1e3", want: 1000},
		{name: "exponent with sign", input: "2.5E-2", want: 0.025},
		{name: "exponent with plus", input: "1e+2", want: 100},

		// Basic operators
		{name: "addition", input: "2 + 3", want: 5},
		{name: "subtraction", input: "2 - 3", want: -1},
		{name: "multiplication", input: "4 * 2.5", want: 10},
		{name: "division", input: "10 / 4", want: 2.5},
		{name: "power", input: "2 ^ 10", want: 1024},

		// Precedence
		{name: "multiplication before addition", input: "2 + 3 * 4", want: 14},
		{name: "division before subtraction", input: "10 - 6 / 2", want: 7},
		{name: "power before multiplication", input: "2 * 3 ^ 2", want: 18},
		{name: "power before division", input: "18 / 3 ^ 2", want: 2},
		{name: "all levels", input: "1 + 2 * 3 ^ 2 - 4 / 2", want: 17},

		// Associativity
		{name: "subtraction is left-associative", input: "10 - 4 - 3", want: 3},
		{name: "division is left-associative", input: "100 / 10 / 5", want: 2},
		{name: "mixed same-level operators", input: "8 / 4 * 2", want: 4},
		{name: "power is right-associative", input: "2 ^ 3 ^ 2", want: 512},

		// Parentheses
		{name: "parentheses override precedence", input: "(2 + 3) * 4", want: 20},
		{name: "nested parentheses", input: "((2 + 3) * (4 - 1)) / 5", want: 3},
		{name: "redundant parentheses", input: "((((7))))", want: 7},
		{name: "parenthesised power base", input: "(2 ^ 3) ^ 2", want: 64},
		{name: "the classic", input: "2 * (3 + 4) ^ 2", want: 98},

		// Unary signs
		{name: "negative literal", input: "-5", want: -5},
		{name: "unary plus", input: "+5", want: 5},
		{name: "double negation", input: "--5", want: 5},
		{name: "subtracting a negative", input: "3 - -2", want: 5},
		{name: "multiplying by a negative", input: "3 * -2", want: -6},
		{name: "negated group", input: "-(2 + 3)", want: -5},
		{name: "power binds tighter than unary minus", input: "-2 ^ 2", want: -4},
		{name: "parenthesised negative base", input: "(-2) ^ 2", want: 4},
		{name: "negative exponent", input: "2 ^ -1", want: 0.5},
		{name: "negative zero is normalised", input: "-0", want: 0},

		// Percent
		{name: "percent", input: "50%", want: 0.5},
		{name: "percent of a value", input: "10% * 200", want: 20},
		{name: "percent discount", input: "200 - 200 * 15%", want: 170},
		{name: "percent of a group", input: "(20 + 30)%", want: 0.5},
		{name: "double percent", input: "50%%", want: 0.005},
		{name: "percent binds tighter than power", input: "4 ^ 50%", want: 2},

		// Functions
		{name: "sqrt", input: "sqrt(16)", want: 4},
		{name: "sqrt of an expression", input: "sqrt(9 + 16)", want: 5},
		{name: "sqrt inside an expression", input: "sqrt(16) + 1", want: 5},
		{name: "nested sqrt", input: "sqrt(sqrt(81))", want: 3},
		{name: "sqrt with power", input: "sqrt(16) ^ 2", want: 16},
		{name: "space before sqrt parenthesis", input: "sqrt (4)", want: 2},

		// Whitespace
		{name: "no spaces", input: "2*(3+4)", want: 14},
		{name: "extra spaces, tabs and newlines", input: "  2 \t*\n( 3 + 4 )  ", want: 14},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := Evaluate(tt.input)
			if err != nil {
				t.Fatalf("Evaluate(%q) returned unexpected error: %v", tt.input, err)
			}
			if math.Abs(got-tt.want) > epsilon {
				t.Errorf("Evaluate(%q) = %v, want %v", tt.input, got, tt.want)
			}
			if math.Signbit(got) && got == 0 {
				t.Errorf("Evaluate(%q) returned negative zero", tt.input)
			}
		})
	}
}

func TestEvaluate_SyntaxErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		wantPos int
		wantMsg string // substring expected in the message
	}{
		{name: "empty", input: "", wantPos: 0, wantMsg: "empty"},
		{name: "only whitespace", input: "   ", wantPos: 3, wantMsg: "empty"},

		{name: "trailing operator", input: "2 +", wantPos: 3, wantMsg: "end of expression"},
		{name: "leading binary operator", input: "* 2", wantPos: 0, wantMsg: `unexpected "*"`},
		{name: "two binary operators", input: "2 * / 3", wantPos: 4, wantMsg: `unexpected "/"`},
		{name: "adjacent numbers", input: "2 3", wantPos: 2, wantMsg: `unexpected "3"`},
		{name: "implicit multiplication", input: "2(3)", wantPos: 1, wantMsg: `unexpected "("`},
		{name: "implicit multiplication after group", input: "(2)3", wantPos: 3, wantMsg: `unexpected "3"`},
		{name: "leading percent", input: "%5", wantPos: 0, wantMsg: `unexpected "%"`},

		{name: "unclosed parenthesis", input: "(2 + 3", wantPos: 6, wantMsg: `missing closing ")"`},
		{name: "unopened parenthesis", input: "2 + 3)", wantPos: 5, wantMsg: `unexpected ")"`},
		{name: "empty parentheses", input: "()", wantPos: 1, wantMsg: "parentheses are empty"},
		{name: "operator before closing parenthesis", input: "(2 +)", wantPos: 4, wantMsg: `unexpected ")"`},
		{name: "adjacent numbers inside parentheses", input: "(2 3)", wantPos: 3, wantMsg: `unexpected "3"`},

		{name: "invalid character", input: "2 $ 3", wantPos: 2, wantMsg: `unexpected character "$"`},
		{name: "non-ASCII character counts as one position", input: "é + 2 # 3", wantPos: 0, wantMsg: `unexpected character "é"`},
		{name: "position is in characters, not bytes", input: "2 + é", wantPos: 4, wantMsg: `unexpected character "é"`},

		{name: "lone decimal point", input: ".", wantPos: 0, wantMsg: "invalid number"},
		{name: "two decimal points", input: "1.2.3", wantPos: 0, wantMsg: `invalid number "1.2.3"`},
		{name: "number too large", input: "1e999", wantPos: 0, wantMsg: "too large"},
		{name: "incomplete exponent", input: "2e", wantPos: 1, wantMsg: `unexpected "e"`},

		{name: "unknown function", input: "cos(0)", wantPos: 0, wantMsg: `unknown function "cos"`},
		{name: "function name is case-sensitive", input: "SQRT(4)", wantPos: 0, wantMsg: `unknown function "SQRT"`},
		{name: "sqrt without parentheses", input: "sqrt 4", wantPos: 5, wantMsg: `expected "(" after "sqrt"`},
		{name: "sqrt at end", input: "sqrt", wantPos: 4, wantMsg: `expected "(" after "sqrt"`},
		{name: "sqrt with empty argument", input: "sqrt()", wantPos: 5, wantMsg: "parentheses are empty"},
		{name: "sqrt unclosed", input: "sqrt(4", wantPos: 6, wantMsg: `missing closing ")"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := Evaluate(tt.input)

			var syntaxErr *SyntaxError
			if !errors.As(err, &syntaxErr) {
				t.Fatalf("Evaluate(%q) error = %v, want a *SyntaxError", tt.input, err)
			}
			if syntaxErr.Pos != tt.wantPos {
				t.Errorf("Evaluate(%q) error position = %d, want %d (message: %q)",
					tt.input, syntaxErr.Pos, tt.wantPos, syntaxErr.Msg)
			}
			if !strings.Contains(syntaxErr.Msg, tt.wantMsg) {
				t.Errorf("Evaluate(%q) error message = %q, want it to contain %q",
					tt.input, syntaxErr.Msg, tt.wantMsg)
			}
		})
	}
}

func TestEvaluate_MathErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		wantErr error
	}{
		{name: "division by zero", input: "1 / 0", wantErr: calculator.ErrDivisionByZero},
		{name: "division by a zero subexpression", input: "10 / (5 - 5)", wantErr: calculator.ErrDivisionByZero},
		{name: "error in left operand", input: "(1 / 0) + 2", wantErr: calculator.ErrDivisionByZero},
		{name: "error in right operand", input: "2 + (1 / 0)", wantErr: calculator.ErrDivisionByZero},
		{name: "error under unary minus", input: "-(1 / 0)", wantErr: calculator.ErrDivisionByZero},
		{name: "error under percent", input: "(1 / 0)%", wantErr: calculator.ErrDivisionByZero},
		{name: "error inside sqrt", input: "sqrt(1 / 0)", wantErr: calculator.ErrDivisionByZero},
		{name: "sqrt of a negative", input: "sqrt(-4)", wantErr: calculator.ErrNegativeSqrt},
		{name: "sqrt of a negative subexpression", input: "sqrt(2 - 6)", wantErr: calculator.ErrNegativeSqrt},
		{name: "power overflow", input: "10 ^ 400", wantErr: calculator.ErrResultOutOfRange},
		{name: "multiplication overflow", input: "1e308 * 10", wantErr: calculator.ErrResultOutOfRange},
		{name: "fractional power of a negative", input: "(-8) ^ 0.5", wantErr: calculator.ErrResultOutOfRange},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if _, err := Evaluate(tt.input); !errors.Is(err, tt.wantErr) {
				t.Errorf("Evaluate(%q) error = %v, want %v", tt.input, err, tt.wantErr)
			}
		})
	}
}

func TestEvaluate_LengthLimit(t *testing.T) {
	t.Parallel()

	atLimit := strings.Repeat("1", MaxLength)
	if _, err := Evaluate(atLimit); err != nil {
		t.Errorf("expression of exactly MaxLength characters returned error: %v", err)
	}

	if _, err := Evaluate(atLimit + "1"); !errors.Is(err, ErrTooLong) {
		t.Errorf("expression over MaxLength: error = %v, want ErrTooLong", err)
	}

	// The limit counts characters, not bytes: MaxLength two-byte characters
	// must reach the lexer (and fail there) instead of tripping the limit.
	if _, err := Evaluate(strings.Repeat("é", MaxLength)); errors.Is(err, ErrTooLong) {
		t.Error("length limit was applied in bytes, want characters")
	}
}

func TestEvaluate_DepthLimit(t *testing.T) {
	t.Parallel()

	nested := func(depth int) string {
		return strings.Repeat("(", depth) + "1" + strings.Repeat(")", depth)
	}

	// Each parenthesis level costs one unit of depth, plus one for the
	// outermost expression.
	if got, err := Evaluate(nested(maxDepth - 1)); err != nil || got != 1 {
		t.Errorf("nesting just under the limit = (%v, %v), want (1, nil)", got, err)
	}

	tooDeep := []struct {
		name  string
		input string
	}{
		{name: "parentheses", input: nested(maxDepth)},
		{name: "unary signs", input: strings.Repeat("-", maxDepth) + "1"},
		{name: "exponent chain", input: strings.Repeat("2^", maxDepth) + "2"},
	}
	for _, tt := range tooDeep {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := Evaluate(tt.input)
			var syntaxErr *SyntaxError
			if !errors.As(err, &syntaxErr) || !strings.Contains(syntaxErr.Msg, "nested too deeply") {
				t.Errorf("error = %v, want a nesting-depth SyntaxError", err)
			}
		})
	}
}

func TestSyntaxError_Error(t *testing.T) {
	t.Parallel()

	err := &SyntaxError{Pos: 7, Msg: `unexpected ")"`}
	if got, want := err.Error(), `syntax error at position 7: unexpected ")"`; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

// FuzzEvaluate checks invariants that must hold for every possible input:
// Evaluate never panics, a successful result is always a finite number, and
// syntax errors always point inside the input.
//
// Run it with:  go test ./internal/expression -fuzz=FuzzEvaluate -fuzztime=30s
func FuzzEvaluate(f *testing.F) {
	seeds := []string{
		"", "1", "2 * (3 + 4) ^ 2", "-2 ^ 2", "10% * 200", "sqrt(16) + 1",
		"1 / 0", "((((", "))))", "1.2.3", "2e", "1e999", "sqrt", "é", "--+-1",
		"2 ^ 3 ^ 2", "50%%", "(1", "1)", "\x00", "9" + strings.Repeat("9", 400),
	}
	for _, seed := range seeds {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, input string) {
		result, err := Evaluate(input)

		if err == nil {
			if math.IsNaN(result) || math.IsInf(result, 0) {
				t.Errorf("Evaluate(%q) = %v without error, want a finite number", input, result)
			}
			return
		}

		var syntaxErr *SyntaxError
		if errors.As(err, &syntaxErr) {
			if n := utf8.RuneCountInString(input); syntaxErr.Pos < 0 || syntaxErr.Pos > n {
				t.Errorf("Evaluate(%q) error position %d is outside [0, %d]", input, syntaxErr.Pos, n)
			}
			if syntaxErr.Msg == "" {
				t.Errorf("Evaluate(%q) returned a SyntaxError with an empty message", input)
			}
		}
	})
}
