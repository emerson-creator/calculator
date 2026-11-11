package calculator

import (
	"errors"
	"math"
	"testing"
)

// epsilon is the tolerance used when comparing floating point results.
const epsilon = 1e-9

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) <= epsilon
}

func TestCalculate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		op   Operation
		a, b float64
		want float64
	}{
		// Addition
		{name: "add positives", op: Add, a: 2, b: 3, want: 5},
		{name: "add negatives", op: Add, a: -2, b: -3, want: -5},
		{name: "add decimals", op: Add, a: 0.1, b: 0.2, want: 0.3},
		{name: "add zero", op: Add, a: 7, b: 0, want: 7},

		// Subtraction
		{name: "subtract positives", op: Subtract, a: 10, b: 4, want: 6},
		{name: "subtract into negative", op: Subtract, a: 4, b: 10, want: -6},
		{name: "subtract a negative", op: Subtract, a: 4, b: -6, want: 10},

		// Multiplication
		{name: "multiply positives", op: Multiply, a: 6, b: 7, want: 42},
		{name: "multiply by zero", op: Multiply, a: 6, b: 0, want: 0},
		{name: "multiply mixed signs", op: Multiply, a: -6, b: 7, want: -42},
		{name: "multiply decimals", op: Multiply, a: 1.5, b: 2.5, want: 3.75},

		// Division
		{name: "divide evenly", op: Divide, a: 10, b: 2, want: 5},
		{name: "divide with fraction", op: Divide, a: 1, b: 4, want: 0.25},
		{name: "divide negative", op: Divide, a: -9, b: 3, want: -3},
		{name: "divide zero numerator", op: Divide, a: 0, b: 5, want: 0},

		// Exponentiation
		{name: "power positive exponent", op: Power, a: 2, b: 10, want: 1024},
		{name: "power zero exponent", op: Power, a: 5, b: 0, want: 1},
		{name: "power negative exponent", op: Power, a: 2, b: -2, want: 0.25},
		{name: "power fractional exponent", op: Power, a: 9, b: 0.5, want: 3},
		{name: "power negative base integer exponent", op: Power, a: -2, b: 3, want: -8},

		// Square root (unary: b must be ignored)
		{name: "sqrt perfect square", op: Sqrt, a: 16, want: 4},
		{name: "sqrt zero", op: Sqrt, a: 0, want: 0},
		{name: "sqrt irrational", op: Sqrt, a: 2, want: math.Sqrt2},
		{name: "sqrt ignores second operand", op: Sqrt, a: 9, b: 123, want: 3},
		{name: "sqrt ignores non-finite second operand", op: Sqrt, a: 9, b: math.NaN(), want: 3},

		// Percentage: a% of b
		{name: "percentage basic", op: Percentage, a: 10, b: 200, want: 20},
		{name: "percentage over 100", op: Percentage, a: 150, b: 80, want: 120},
		{name: "percentage of zero", op: Percentage, a: 25, b: 0, want: 0},
		{name: "percentage decimal", op: Percentage, a: 12.5, b: 80, want: 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := Calculate(tt.op, tt.a, tt.b)
			if err != nil {
				t.Fatalf("Calculate(%q, %v, %v) returned unexpected error: %v", tt.op, tt.a, tt.b, err)
			}
			if !almostEqual(got, tt.want) {
				t.Errorf("Calculate(%q, %v, %v) = %v, want %v", tt.op, tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestCalculateErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		op      Operation
		a, b    float64
		wantErr error
	}{
		{name: "unknown operation", op: "modulo", a: 1, b: 2, wantErr: ErrUnknownOperation},
		{name: "empty operation", op: "", a: 1, b: 2, wantErr: ErrUnknownOperation},
		{name: "operation is case sensitive", op: "ADD", a: 1, b: 2, wantErr: ErrUnknownOperation},

		{name: "divide by zero", op: Divide, a: 10, b: 0, wantErr: ErrDivisionByZero},
		{name: "divide zero by zero", op: Divide, a: 0, b: 0, wantErr: ErrDivisionByZero},
		{name: "divide by negative zero", op: Divide, a: 1, b: math.Copysign(0, -1), wantErr: ErrDivisionByZero},

		{name: "sqrt of negative", op: Sqrt, a: -4, wantErr: ErrNegativeSqrt},

		{name: "NaN first operand", op: Add, a: math.NaN(), b: 1, wantErr: ErrInvalidOperand},
		{name: "NaN second operand", op: Add, a: 1, b: math.NaN(), wantErr: ErrInvalidOperand},
		{name: "infinite first operand", op: Multiply, a: math.Inf(1), b: 2, wantErr: ErrInvalidOperand},
		{name: "infinite second operand", op: Multiply, a: 2, b: math.Inf(-1), wantErr: ErrInvalidOperand},
		{name: "NaN operand on unary operation", op: Sqrt, a: math.NaN(), wantErr: ErrInvalidOperand},

		{name: "addition overflow", op: Add, a: math.MaxFloat64, b: math.MaxFloat64, wantErr: ErrResultOutOfRange},
		{name: "multiplication overflow", op: Multiply, a: math.MaxFloat64, b: 2, wantErr: ErrResultOutOfRange},
		{name: "power overflow", op: Power, a: 10, b: 400, wantErr: ErrResultOutOfRange},
		{name: "fractional power of negative base", op: Power, a: -8, b: 1.0 / 3.0, wantErr: ErrResultOutOfRange},
		{name: "zero to a negative power", op: Power, a: 0, b: -1, wantErr: ErrResultOutOfRange},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := Calculate(tt.op, tt.a, tt.b)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Calculate(%q, %v, %v) error = %v, want %v", tt.op, tt.a, tt.b, err, tt.wantErr)
			}
			if got != 0 {
				t.Errorf("Calculate(%q, %v, %v) = %v on error, want 0", tt.op, tt.a, tt.b, got)
			}
		})
	}
}

func TestArity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		op        Operation
		wantArity int
		wantOK    bool
	}{
		{op: Add, wantArity: 2, wantOK: true},
		{op: Subtract, wantArity: 2, wantOK: true},
		{op: Multiply, wantArity: 2, wantOK: true},
		{op: Divide, wantArity: 2, wantOK: true},
		{op: Power, wantArity: 2, wantOK: true},
		{op: Percentage, wantArity: 2, wantOK: true},
		{op: Sqrt, wantArity: 1, wantOK: true},
		{op: "modulo", wantArity: 0, wantOK: false},
	}

	for _, tt := range tests {
		t.Run(string(tt.op), func(t *testing.T) {
			t.Parallel()

			arity, ok := Arity(tt.op)
			if arity != tt.wantArity || ok != tt.wantOK {
				t.Errorf("Arity(%q) = (%d, %t), want (%d, %t)", tt.op, arity, ok, tt.wantArity, tt.wantOK)
			}
		})
	}
}

func TestOperations(t *testing.T) {
	t.Parallel()

	want := []Operation{Add, Divide, Multiply, Percentage, Power, Sqrt, Subtract}
	got := Operations()

	if len(got) != len(want) {
		t.Fatalf("Operations() returned %d operations, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Operations()[%d] = %q, want %q (full list: %v)", i, got[i], want[i], got)
		}
	}
}