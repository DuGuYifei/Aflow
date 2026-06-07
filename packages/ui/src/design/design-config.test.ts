import type { AgentServerCapabilities } from "../api";
import { reconcileDesignConfigOptions } from "./design-config";

declare function describe(name: string, callback: () => void): void;
declare function test(name: string, callback: () => void): void;
declare const expect: (value: unknown) => {
  toEqual(expected: unknown): void;
};

describe("reconcileDesignConfigOptions", () => {
  test("drops config values that the current capabilities do not advertise", () => {
    const next = reconcileDesignConfigOptions(capabilitiesWithOptions([
      selectOption("model", "model", ["gpt-5.5"]),
    ]), {
      model: "gpt-5.5",
      reasoning_effort: "high",
      stale_key: "x",
    });

    expect(next).toEqual({ model: "gpt-5.5" });
  });

  test("defaults advertised reasoning controls to High only when present", () => {
    const next = reconcileDesignConfigOptions(capabilitiesWithOptions([
      selectOption("reasoning_effort", "thought_level", ["low", "medium", "high", "xhigh"]),
    ]), {});

    expect(next).toEqual({ reasoning_effort: "high" });
    expect(reconcileDesignConfigOptions(undefined, { reasoning_effort: "high" })).toEqual({});
  });

  test("drops invalid select values before applying defaults", () => {
    const next = reconcileDesignConfigOptions(capabilitiesWithOptions([
      selectOption("reasoning", "thought_level", ["low", "medium", "high"]),
    ]), {
      reasoning: "xhigh",
    });

    expect(next).toEqual({ reasoning: "high" });
  });
});

function capabilitiesWithOptions(configOptions: NonNullable<AgentServerCapabilities["configOptions"]>): AgentServerCapabilities {
  return {
    probedAt: "2026-06-06T00:00:00.000Z",
    agentCapabilities: {},
    modes: null,
    configOptions,
    availableCommands: [],
  };
}

function selectOption(id: string, category: string, values: string[]): NonNullable<AgentServerCapabilities["configOptions"]>[number] {
  return {
    id,
    name: id,
    category,
    type: "select",
    options: values.map((value) => ({ value, name: label(value) })),
  };
}

function label(value: string): string {
  return value === "xhigh" ? "Xhigh" : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
