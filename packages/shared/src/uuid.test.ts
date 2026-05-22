import { describe, expect, it } from "bun:test";
import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("encodes the UUID version, variant, and supplied timestamp", () => {
    const id = uuidv7(0x019e_4a1d_45c0);
    expect(id).toMatch(/^019e4a1d-45c0-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
