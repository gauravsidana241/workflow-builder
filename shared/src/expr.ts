/**
 * A small, safe expression language used by If / While / Set Variable / Return
 * nodes and by {{templates}} in HTTP and Log nodes.
 *
 * Why not just `eval` or `new Function`? Expressions run INSIDE the Temporal
 * workflow, which must be deterministic, and they come from users. This
 * evaluator only knows literals, variables, operators and a whitelist of pure
 * functions: no Date, no Math.random, no I/O, no prototype access.
 *
 * Syntax is a JavaScript subset:
 *   literals     1, 2.5, "text", 'text', true, false, null, [1, 2], { a: 1 }
 *   variables    total, input.users[0].name
 *   operators    + - * / %  == != === !== < <= > >=  && || ?? !  a ? b : c
 *   functions    len(x), upper(s), keys(obj), ... (see FUNCTIONS below)
 */

export class ExprError extends Error {
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(position === undefined ? message : `${message} (at position ${position})`);
    this.name = "ExprError";
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "num"; value: number; pos: number }
  | { kind: "str"; value: string; pos: number }
  | { kind: "ident"; value: string; pos: number }
  | { kind: "op"; value: string; pos: number }
  | { kind: "eof"; pos: number };

// Longest operators first so "===" wins over "==".
const OPERATORS = [
  "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "??",
  "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", ".", ",", "(", ")", "[", "]", "{", "}",
];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      tokens.push({ kind: "num", value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      let out = "";
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") {
          const next = src[i + 1];
          const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'" };
          if (next === undefined) throw new ExprError("Unterminated string", start);
          out += escapes[next] ?? next;
          i += 2;
        } else {
          out += src[i++];
        }
      }
      if (i >= src.length) throw new ExprError("Unterminated string", start);
      i++; // closing quote
      tokens.push({ kind: "str", value: out, pos: start });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      tokens.push({ kind: "ident", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character "${ch}"`, i);
    tokens.push({ kind: "op", value: op, pos: i });
    i += op.length;
  }
  tokens.push({ kind: "eof", pos: src.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (precedence climbing) -> AST
// ---------------------------------------------------------------------------

export type Ast =
  | { type: "literal"; value: unknown }
  | { type: "var"; name: string; pos: number }
  | { type: "member"; object: Ast; property: Ast; pos: number }
  | { type: "call"; name: string; args: Ast[]; pos: number }
  | { type: "unary"; op: string; arg: Ast }
  | { type: "binary"; op: string; left: Ast; right: Ast }
  | { type: "ternary"; test: Ast; then: Ast; else: Ast }
  | { type: "array"; items: Ast[] }
  | { type: "object"; entries: [string, Ast][] };

// Binary operator precedence; higher binds tighter.
const PRECEDENCE: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "==": 4, "!=": 4, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
};

const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null, undefined: undefined };

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Ast {
    const ast = this.ternary();
    const t = this.peek();
    if (t.kind !== "eof") throw new ExprError(`Unexpected "${tokenText(t)}"`, t.pos);
    return ast;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private isOp(value: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.value === value;
  }
  private expectOp(value: string): void {
    const t = this.next();
    if (t.kind !== "op" || t.value !== value) {
      throw new ExprError(`Expected "${value}" but found "${tokenText(t)}"`, t.pos);
    }
  }

  private ternary(): Ast {
    const test = this.binary(0);
    if (!this.isOp("?")) return test;
    this.next();
    const thenBranch = this.ternary();
    this.expectOp(":");
    const elseBranch = this.ternary();
    return { type: "ternary", test, then: thenBranch, else: elseBranch };
  }

  private binary(minPrec: number): Ast {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      const prec = t.kind === "op" ? PRECEDENCE[t.value] : undefined;
      if (prec === undefined || prec <= minPrec) return left;
      this.next();
      const right = this.binary(prec);
      left = { type: "binary", op: (t as { value: string }).value, left, right };
    }
  }

  private unary(): Ast {
    if (this.isOp("!") || this.isOp("-") || this.isOp("+")) {
      const op = (this.next() as { value: string }).value;
      return { type: "unary", op, arg: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Ast {
    let node = this.primary();
    for (;;) {
      if (this.isOp(".")) {
        const dot = this.next();
        const name = this.next();
        if (name.kind !== "ident") throw new ExprError("Expected a property name after \".\"", dot.pos);
        node = { type: "member", object: node, property: { type: "literal", value: name.value }, pos: name.pos };
      } else if (this.isOp("[")) {
        const open = this.next();
        const property = this.ternary();
        this.expectOp("]");
        node = { type: "member", object: node, property, pos: open.pos };
      } else {
        return node;
      }
    }
  }

  private primary(): Ast {
    const t = this.next();
    switch (t.kind) {
      case "num":
      case "str":
        return { type: "literal", value: t.value };
      case "ident": {
        if (Object.hasOwn(KEYWORDS, t.value)) return { type: "literal", value: KEYWORDS[t.value] };
        if (this.isOp("(")) {
          this.next();
          const args: Ast[] = [];
          while (!this.isOp(")")) {
            args.push(this.ternary());
            if (!this.isOp(")")) this.expectOp(",");
          }
          this.next();
          if (!Object.hasOwn(FUNCTIONS, t.value)) {
            throw new ExprError(`Unknown function "${t.value}". Available: ${Object.keys(FUNCTIONS).join(", ")}`, t.pos);
          }
          return { type: "call", name: t.value, args, pos: t.pos };
        }
        return { type: "var", name: t.value, pos: t.pos };
      }
      case "op":
        if (t.value === "(") {
          const inner = this.ternary();
          this.expectOp(")");
          return inner;
        }
        if (t.value === "[") {
          const items: Ast[] = [];
          while (!this.isOp("]")) {
            items.push(this.ternary());
            if (!this.isOp("]")) this.expectOp(",");
          }
          this.next();
          return { type: "array", items };
        }
        if (t.value === "{") {
          const entries: [string, Ast][] = [];
          while (!this.isOp("}")) {
            const key = this.next();
            if (key.kind !== "ident" && key.kind !== "str") throw new ExprError("Expected an object key", key.pos);
            if (this.isOp(":")) {
              this.next();
              entries.push([key.value, this.ternary()]);
            } else if (key.kind === "ident") {
              // Shorthand { total } means { total: total }
              entries.push([key.value, { type: "var", name: key.value, pos: key.pos }]);
            } else {
              throw new ExprError('Expected ":" after object key', key.pos);
            }
            if (!this.isOp("}")) this.expectOp(",");
          }
          this.next();
          return { type: "object", entries };
        }
        throw new ExprError(`Unexpected "${t.value}"`, t.pos);
      case "eof":
        throw new ExprError("Unexpected end of expression", t.pos);
    }
  }
}

function tokenText(t: Token): string {
  return t.kind === "eof" ? "end of expression" : String(t.value);
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export type Scope = Record<string, unknown>;

const BLOCKED_PROPERTIES = new Set(["__proto__", "prototype", "constructor"]);

function getProperty(object: unknown, key: unknown, pos: number): unknown {
  if (object === null || object === undefined) {
    throw new ExprError(`Cannot read property "${String(key)}" of ${object}`, pos);
  }
  const k = typeof key === "number" ? key : String(key);
  if (typeof k === "string" && BLOCKED_PROPERTIES.has(k)) {
    throw new ExprError(`Access to "${k}" is not allowed`, pos);
  }
  if (typeof object === "string") {
    if (k === "length") return object.length;
    return typeof k === "number" ? object[k] : undefined;
  }
  if (Array.isArray(object)) {
    if (k === "length") return object.length;
  }
  if (typeof object === "object") {
    // Own properties only: never walk up into Object.prototype / Array.prototype.
    return Object.hasOwn(object, k) ? (object as Record<string | number, unknown>)[k] : undefined;
  }
  return undefined;
}

function toNumber(v: unknown, what: string): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  throw new ExprError(`Expected a number for ${what} but got ${describe(v)}`);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return typeof v === "string" ? `"${v}"` : typeof v;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  // Structural equality for arrays/objects, so [1,2] == [1,2] is true.
  return JSON.stringify(a) === JSON.stringify(b);
}

function evalAst(node: Ast, scope: Scope): unknown {
  switch (node.type) {
    case "literal":
      return node.value;
    case "var":
      if (!Object.hasOwn(scope, node.name)) {
        throw new ExprError(`Unknown variable "${node.name}"`, node.pos);
      }
      return scope[node.name];
    case "member":
      return getProperty(evalAst(node.object, scope), evalAst(node.property, scope), node.pos);
    case "call":
      return FUNCTIONS[node.name](...node.args.map((a) => evalAst(a, scope)));
    case "array":
      return node.items.map((item) => evalAst(item, scope));
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, value] of node.entries) {
        if (BLOCKED_PROPERTIES.has(key)) throw new ExprError(`Key "${key}" is not allowed`);
        out[key] = evalAst(value, scope);
      }
      return out;
    }
    case "unary": {
      const v = evalAst(node.arg, scope);
      if (node.op === "!") return !v;
      if (node.op === "-") return -toNumber(v, "unary -");
      return toNumber(v, "unary +");
    }
    case "ternary":
      return evalAst(node.test, scope) ? evalAst(node.then, scope) : evalAst(node.else, scope);
    case "binary": {
      // Short-circuit operators evaluate the right side only when needed.
      if (node.op === "&&") {
        const l = evalAst(node.left, scope);
        return l ? evalAst(node.right, scope) : l;
      }
      if (node.op === "||") {
        const l = evalAst(node.left, scope);
        return l ? l : evalAst(node.right, scope);
      }
      if (node.op === "??") {
        // `count ?? 0` should work before `count` has ever been set.
        const l =
          node.left.type === "var" && !Object.hasOwn(scope, node.left.name) ? undefined : evalAst(node.left, scope);
        return l ?? evalAst(node.right, scope);
      }
      const l = evalAst(node.left, scope);
      const r = evalAst(node.right, scope);
      switch (node.op) {
        case "+":
          if (typeof l === "string" || typeof r === "string") return stringify(l) + stringify(r);
          if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
          return toNumber(l, "+") + toNumber(r, "+");
        case "-":
          return toNumber(l, "-") - toNumber(r, "-");
        case "*":
          return toNumber(l, "*") * toNumber(r, "*");
        case "/":
          return toNumber(l, "/") / toNumber(r, "/");
        case "%":
          return toNumber(l, "%") % toNumber(r, "%");
        // == and === behave the same: strict, plus structural for objects/arrays.
        case "==":
        case "===":
          return isEqual(l, r);
        case "!=":
        case "!==":
          return !isEqual(l, r);
        case "<":
          return compare(l, r) < 0;
        case "<=":
          return compare(l, r) <= 0;
        case ">":
          return compare(l, r) > 0;
        case ">=":
          return compare(l, r) >= 0;
      }
      throw new ExprError(`Unknown operator "${node.op}"`);
    }
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return toNumber(a, "comparison") - toNumber(b, "comparison");
}

/** Turn any value into display text: strings as-is, everything else as JSON. */
export function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined) return "";
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Built-in functions (all pure)
// ---------------------------------------------------------------------------

type Fn = (...args: unknown[]) => unknown;

function asArray(v: unknown, fn: string): unknown[] {
  if (!Array.isArray(v)) throw new ExprError(`${fn}() expects an array but got ${describe(v)}`);
  return v;
}
function asString(v: unknown, fn: string): string {
  if (typeof v !== "string") throw new ExprError(`${fn}() expects a string but got ${describe(v)}`);
  return v;
}
function asObject(v: unknown, fn: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ExprError(`${fn}() expects an object but got ${describe(v)}`);
  }
  return v as Record<string, unknown>;
}

export const FUNCTIONS: Record<string, Fn> = {
  len: (v) => {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    if (typeof v === "object" && v !== null) return Object.keys(v).length;
    throw new ExprError(`len() expects a string, array or object but got ${describe(v)}`);
  },
  upper: (s) => asString(s, "upper").toUpperCase(),
  lower: (s) => asString(s, "lower").toLowerCase(),
  trim: (s) => asString(s, "trim").trim(),
  split: (s, sep) => asString(s, "split").split(asString(sep, "split")),
  join: (arr, sep) => asArray(arr, "join").map(stringify).join(sep === undefined ? "," : asString(sep, "join")),
  includes: (haystack, needle) => {
    if (typeof haystack === "string") return haystack.includes(stringify(needle));
    return asArray(haystack, "includes").some((x) => isEqual(x, needle));
  },
  slice: (v, start, end) => {
    if (typeof v !== "string" && !Array.isArray(v)) throw new ExprError("slice() expects a string or array");
    return v.slice(toNumber(start ?? 0, "slice"), end === undefined ? undefined : toNumber(end, "slice"));
  },
  keys: (o) => Object.keys(asObject(o, "keys")),
  values: (o) => Object.values(asObject(o, "values")),
  range: (a, b) => {
    // range(3) -> [0,1,2]; range(2,5) -> [2,3,4]
    const [start, end] = b === undefined ? [0, toNumber(a, "range")] : [toNumber(a, "range"), toNumber(b, "range")];
    if (end - start > 10_000) throw new ExprError("range() is limited to 10000 items");
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  },
  sum: (arr) => asArray(arr, "sum").reduce<number>((acc, x) => acc + toNumber(x, "sum"), 0),
  min: (...args) => Math.min(...(args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map((x) => toNumber(x, "min"))),
  max: (...args) => Math.max(...(args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map((x) => toNumber(x, "max"))),
  round: (n, digits) => {
    const f = 10 ** (digits === undefined ? 0 : toNumber(digits, "round"));
    return Math.round(toNumber(n, "round") * f) / f;
  },
  floor: (n) => Math.floor(toNumber(n, "floor")),
  ceil: (n) => Math.ceil(toNumber(n, "ceil")),
  abs: (n) => Math.abs(toNumber(n, "abs")),
  number: (v) => toNumber(v, "number"),
  string: (v) => stringify(v),
  bool: (v) => Boolean(v),
  json: (v) => JSON.stringify(v),
  parseJson: (s) => {
    try {
      return JSON.parse(asString(s, "parseJson"));
    } catch (err) {
      throw new ExprError(`parseJson(): ${(err as Error).message}`);
    }
  },
  typeOf: (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const cache = new Map<string, Ast>();

export function parseExpression(src: string): Ast {
  const cached = cache.get(src);
  if (cached) return cached;
  if (src.trim() === "") throw new ExprError("Expression is empty");
  const ast = new Parser(tokenize(src)).parse();
  if (cache.size > 1000) cache.clear();
  cache.set(src, ast);
  return ast;
}

export function evaluate(src: string, scope: Scope): unknown {
  return evalAst(parseExpression(src), scope);
}

/** Returns an error message if the expression doesn't parse, otherwise null. */
export function checkExpression(src: string): string | null {
  try {
    parseExpression(src);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

// ---------------------------------------------------------------------------
// Templates: "Hello {{ user.name }}, you have {{ len(items) }} items"
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;
const SINGLE_TEMPLATE_RE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;

/** Render a template to a string. Non-string values are inserted as JSON. */
export function renderTemplate(template: string, scope: Scope): string {
  return template.replace(TEMPLATE_RE, (_, expr: string) => stringify(evaluate(expr, scope)));
}

/**
 * Like renderTemplate, but if the whole template is a single {{ expr }} the raw
 * value is returned (so "{{ input.user }}" yields the object, not its JSON text).
 */
export function resolveTemplate(template: string, scope: Scope): unknown {
  const single = SINGLE_TEMPLATE_RE.exec(template);
  if (single && !single[1].includes("}}")) return evaluate(single[1], scope);
  return renderTemplate(template, scope);
}

/** Returns an error message for the first bad {{ }} block, otherwise null. */
export function checkTemplate(template: string): string | null {
  for (const match of template.matchAll(TEMPLATE_RE)) {
    const error = checkExpression(match[1]);
    if (error) return `In {{${match[1]}}}: ${error}`;
  }
  return null;
}
