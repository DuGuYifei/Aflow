import type { WorkflowNode } from "../types";
import { calculateCanvasFit } from "./canvas";

declare function describe(name: string, callback: () => void): void;
declare function test(name: string, callback: () => void): void;
declare const expect: (value: unknown) => {
  not: { toBeNull(): void };
  toBe(expected: unknown): void;
  toBeLessThan(expected: number): void;
};

describe("calculateCanvasFit", () => {
  test("anchors the left boundary near the visible left edge", () => {
    const nodes: WorkflowNode[] = [
      stepNode("n1", 300, 120, 220),
      stepNode("n2", 720, 420, 260),
    ];

    const canvasFit = calculateCanvasFit(nodes, { width: 1200, height: 720 });

    expect(canvasFit).not.toBeNull();
    expect(Math.round(300 * canvasFit!.zoom + canvasFit!.pan.x)).toBe(96);
    expect(Math.round(((120 + 420 + 120) / 2) * canvasFit!.zoom + canvasFit!.pan.y)).toBe(360);
  });

  test("zooms out enough to keep wide workflows visible", () => {
    const nodes: WorkflowNode[] = [
      stepNode("n1", 100, 100, 220),
      stepNode("n2", 2100, 100, 220),
    ];

    const canvasFit = calculateCanvasFit(nodes, { width: 900, height: 600 });

    expect(canvasFit).not.toBeNull();
    expect(canvasFit!.zoom).toBeLessThan(0.4);
  });
});

function stepNode(id: string, x: number, y: number, width: number): Extract<WorkflowNode, { kind: "step" }> {
  return {
    kind: "step",
    id,
    alias: id,
    x,
    y,
    w: width,
    title: id,
    prompt: "",
    sessionId: "s1",
  };
}
