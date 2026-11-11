package expression

import "github.com/emerson-creator/calculator/backend/internal/calculator"

// node is one node of an expression's abstract syntax tree.
//
// Evaluation is delegated to the calculator package wherever an arithmetic
// rule is involved, so behaviour such as division by zero or overflow
// detection is defined in exactly one place.
type node interface {
	eval() (float64, error)
}

// numberNode is a numeric literal.
type numberNode struct {
	value float64
}

func (n numberNode) eval() (float64, error) {
	return n.value, nil
}

// negateNode is a unary minus applied to an operand.
type negateNode struct {
	operand node
}

func (n negateNode) eval() (float64, error) {
	v, err := n.operand.eval()
	if err != nil {
		return 0, err
	}
	return -v, nil
}

// binaryNode applies a two-operand calculator operation.
type binaryNode struct {
	op          calculator.Operation
	left, right node
}

func (n binaryNode) eval() (float64, error) {
	l, err := n.left.eval()
	if err != nil {
		return 0, err
	}
	r, err := n.right.eval()
	if err != nil {
		return 0, err
	}
	return calculator.Calculate(n.op, l, r)
}

// percentNode is the postfix percent operator: x% means x / 100.
type percentNode struct {
	operand node
}

func (n percentNode) eval() (float64, error) {
	v, err := n.operand.eval()
	if err != nil {
		return 0, err
	}
	return calculator.Calculate(calculator.Divide, v, 100)
}

// sqrtNode is a call to the sqrt function.
type sqrtNode struct {
	operand node
}

func (n sqrtNode) eval() (float64, error) {
	v, err := n.operand.eval()
	if err != nil {
		return 0, err
	}
	return calculator.Calculate(calculator.Sqrt, v, 0)
}
