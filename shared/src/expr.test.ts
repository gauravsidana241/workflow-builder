import { describe, expect, it } from "vitest";
import { checkExpression, checkTemplate, evaluate, renderTemplate, resolveTemplate } from "./expr";

const scope = {
  input: { users: [{ name: "Ada", age: 36 }, { name: "Linus", age: 54 }], token: "abc" },
  total: 10,
  name: "world",
  items: [1, 2, 3],
};

describe("evaluate", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 % 3", 1],
    ["-total + 1", -9],
    ['"a" + 1', "a1"],
    ["total > 5 && total < 20", true],
    ["total == 10", true],
    ["total != 10", false],
    ["[1, 2] == [1, 2]", true],
    ["missing ?? 'fallback'", "fallback"],
    ["null ?? 'fallback'", "fallback"],
    ["0 || 'x'", "x"],
    ["!true", false],
    ["total > 5 ? 'big' : 'small'", "big"],
    ["input.users[1].name", "Linus"],
    ["input.users.length", 2],
    ["len(items)", 3],
    ["sum(items)", 6],
    ["upper(name)", "WORLD"],
    ["join(items, '-')", "1-2-3"],
    ["includes(items, 2)", true],
    ["range(3)", [0, 1, 2]],
    ["round(3.14159, 2)", 3.14],
    ["{ total, doubled: total * 2 }", { total: 10, doubled: 20 }],
    ["items + [4]", [1, 2, 3, 4]],
    ["'it\\'s'", "it's"],
  ])("%s", (src, expected) => {
    expect(evaluate(src, scope)).toEqual(expected);
  });

  it("treats an unknown variable as an error unless ?? guards it", () => {
    expect(() => evaluate("missing + 1", scope)).toThrow(/Unknown variable "missing"/);
    expect(evaluate("(missing ?? 0) + 1", scope)).toBe(1);
  });

  it("blocks prototype access", () => {
    expect(() => evaluate("input.constructor", scope)).toThrow(/not allowed/);
    expect(() => evaluate("input['__proto__']", scope)).toThrow(/not allowed/);
    expect(evaluate("input.toString", scope)).toBeUndefined();
  });

  it("does not treat Object.prototype names as keywords", () => {
    expect(() => evaluate("toString", scope)).toThrow(/Unknown variable/);
  });

  it("rejects unknown functions at parse time", () => {
    expect(checkExpression("eval('1')")).toMatch(/Unknown function "eval"/);
  });

  it("reports syntax errors with a position", () => {
    expect(checkExpression("1 +")).toMatch(/Unexpected end of expression/);
    expect(checkExpression("total ==")).toMatch(/position/);
    expect(checkExpression("a b")).toMatch(/Unexpected "b"/);
  });

  it("errors on null property access", () => {
    expect(() => evaluate("input.nope.deeper", scope)).toThrow(/Cannot read property "deeper" of undefined/);
  });
});

describe("templates", () => {
  it("renders strings", () => {
    expect(renderTemplate("Hello {{ name }}, total={{ total + 1 }}", scope)).toBe("Hello world, total=11");
  });

  it("inserts non-strings as JSON", () => {
    expect(renderTemplate("items: {{ items }}", scope)).toBe("items: [1,2,3]");
  });

  it("resolveTemplate keeps the raw value for a single expression", () => {
    expect(resolveTemplate("{{ input.users[0] }}", scope)).toEqual({ name: "Ada", age: 36 });
    expect(resolveTemplate("id={{ total }}", scope)).toBe("id=10");
  });

  it("checks every block", () => {
    expect(checkTemplate("ok {{ total }} bad {{ 1 + }}")).toMatch(/In \{\{ 1 \+ \}\}/);
    expect(checkTemplate("no templates here")).toBeNull();
  });
});
