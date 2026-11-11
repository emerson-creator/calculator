package expression

import "github.com/emerson-creator/calculator/backend/internal/calculator"

// maxDepth bounds how deeply an expression may nest (parentheses, chained
// unary signs, chained exponents). It keeps the recursive parser's stack use
// small and predictable regardless of the input.
const maxDepth = 64

// parser is a recursive-descent parser: each precedence level of the grammar
// is one method, and lower-precedence methods call higher-precedence ones.
//
// Grammar, from lowest to highest precedence:
//
//	expression = term    { ("+" | "-") term } .
//	term       = unary   { ("*" | "/") unary } .
//	unary      = ("+" | "-") unary | power .
//	power      = postfix [ "^" unary ] .
//	postfix    = primary { "%" } .
//	primary    = number | "(" expression ")" | "sqrt" "(" expression ")" .
//
// Consequences worth knowing:
//
//   - "+", "-", "*" and "/" are left-associative: 10 - 4 - 3 = 3.
//   - "^" is right-associative: 2 ^ 3 ^ 2 = 2 ^ 9 = 512.
//   - "^" binds tighter than a leading sign: -2 ^ 2 = -(2 ^ 2) = -4, but its
//     exponent may itself be signed: 2 ^ -1 = 0.5.
//   - "%" binds tightest: 50% = 0.5, so 10% * 200 = 20.
type parser struct {
	tokens []token
	pos    int
	depth  int
}

// parse turns tokens (as produced by lex) into a syntax tree.
func parse(tokens []token) (node, error) {
	p := &parser{tokens: tokens}

	if p.peek().kind == tokEOF {
		return nil, syntaxErrorf(p.peek().pos, "expression is empty")
	}

	root, err := p.parseExpression()
	if err != nil {
		return nil, err
	}
	if tok := p.peek(); tok.kind != tokEOF {
		return nil, unexpected(tok)
	}
	return root, nil
}

func (p *parser) peek() token {
	return p.tokens[p.pos]
}

// next consumes and returns the current token. It never advances past the
// trailing tokEOF.
func (p *parser) next() token {
	tok := p.tokens[p.pos]
	if tok.kind != tokEOF {
		p.pos++
	}
	return tok
}

func (p *parser) parseExpression() (node, error) {
	left, err := p.parseTerm()
	if err != nil {
		return nil, err
	}

	for {
		var op calculator.Operation
		switch p.peek().kind {
		case tokPlus:
			op = calculator.Add
		case tokMinus:
			op = calculator.Subtract
		default:
			return left, nil
		}
		p.next()

		right, err := p.parseTerm()
		if err != nil {
			return nil, err
		}
		left = binaryNode{op: op, left: left, right: right}
	}
}

func (p *parser) parseTerm() (node, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}

	for {
		var op calculator.Operation
		switch p.peek().kind {
		case tokStar:
			op = calculator.Multiply
		case tokSlash:
			op = calculator.Divide
		default:
			return left, nil
		}
		p.next()

		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = binaryNode{op: op, left: left, right: right}
	}
}

// parseUnary is the single point every recursive path goes through
// (parentheses, sign chains and exponent chains), so it is where nesting
// depth is enforced.
func (p *parser) parseUnary() (node, error) {
	p.depth++
	defer func() { p.depth-- }()
	if p.depth > maxDepth {
		return nil, syntaxErrorf(p.peek().pos, "expression is nested too deeply")
	}

	switch p.peek().kind {
	case tokMinus:
		p.next()
		operand, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return negateNode{operand: operand}, nil
	case tokPlus:
		p.next()
		return p.parseUnary()
	default:
		return p.parsePower()
	}
}

func (p *parser) parsePower() (node, error) {
	base, err := p.parsePostfix()
	if err != nil {
		return nil, err
	}
	if p.peek().kind != tokCaret {
		return base, nil
	}
	p.next()

	// Recursing into parseUnary (rather than looping) is what makes "^"
	// right-associative and lets the exponent carry its own sign.
	exponent, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	return binaryNode{op: calculator.Power, left: base, right: exponent}, nil
}

func (p *parser) parsePostfix() (node, error) {
	operand, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}
	for p.peek().kind == tokPercent {
		p.next()
		operand = percentNode{operand: operand}
	}
	return operand, nil
}

func (p *parser) parsePrimary() (node, error) {
	tok := p.next()

	switch tok.kind {
	case tokNumber:
		return numberNode{value: tok.value}, nil

	case tokLParen:
		return p.parseGroup()

	case tokIdent:
		if tok.text != "sqrt" {
			return nil, syntaxErrorf(tok.pos, "unknown function %q", tok.text)
		}
		if open := p.next(); open.kind != tokLParen {
			return nil, syntaxErrorf(open.pos, `expected "(" after "sqrt"`)
		}
		operand, err := p.parseGroup()
		if err != nil {
			return nil, err
		}
		return sqrtNode{operand: operand}, nil

	default:
		return nil, unexpected(tok)
	}
}

// parseGroup parses the inside of a parenthesised group and its closing
// parenthesis. The opening parenthesis must already be consumed.
func (p *parser) parseGroup() (node, error) {
	if tok := p.peek(); tok.kind == tokRParen {
		return nil, syntaxErrorf(tok.pos, "parentheses are empty")
	}

	inner, err := p.parseExpression()
	if err != nil {
		return nil, err
	}
	if tok := p.next(); tok.kind != tokRParen {
		if tok.kind == tokEOF {
			return nil, syntaxErrorf(tok.pos, `missing closing ")"`)
		}
		return nil, unexpected(tok)
	}
	return inner, nil
}

func unexpected(tok token) *SyntaxError {
	if tok.kind == tokEOF {
		return syntaxErrorf(tok.pos, "unexpected end of expression")
	}
	return syntaxErrorf(tok.pos, "unexpected %q", tok.text)
}
