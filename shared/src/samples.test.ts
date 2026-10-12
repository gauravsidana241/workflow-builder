import { describe, expect, it } from "vitest";
import { compileGraph } from "./compile";
import { SAMPLE_WORKFLOWS } from "./samples";

describe("sample workflows", () => {
  it.each(SAMPLE_WORKFLOWS.map((s) => [s.name, s] as const))("%s compiles cleanly", (_, sample) => {
    const { dsl, issues } = compileGraph(sample.graph);
    expect(issues).toEqual([]);
    expect(dsl).not.toBeNull();
  });
});
