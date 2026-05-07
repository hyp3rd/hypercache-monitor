import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer";

/**
 * Unit-tests the pure data structure. The hook layer that
 * pushes samples on TanStack Query refetch lives separately
 * and is exercised by component tests + E2E.
 *
 * The two non-obvious behaviors covered here:
 *   - counter-reset handling (`null` rate, not a negative
 *     number that would distort the Y-axis)
 *   - out-of-order pushes are rejected (clock-skew defense)
 */

describe("RingBuffer", () => {
  it("rejects capacity < 2 — deltas need at least two samples", () => {
    expect(() => new RingBuffer(1)).toThrow();
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-5)).toThrow();
  });

  it("rejects non-integer capacity", () => {
    expect(() => new RingBuffer(2.5)).toThrow();
  });

  it("starts empty and produces no deltas with < 2 samples", () => {
    const rb = new RingBuffer(10);
    expect(rb.size()).toBe(0);
    expect(rb.deltas()).toEqual([]);
    expect(rb.latestRate()).toBeNull();

    rb.push({ t: 1000, v: 5 });
    expect(rb.size()).toBe(1);
    expect(rb.latestRate()).toBeNull();
  });

  it("computes per-second rates between consecutive samples", () => {
    const rb = new RingBuffer(10);
    rb.push({ t: 1000, v: 100 });
    rb.push({ t: 6000, v: 600 }); // +500 over 5s = 100/s
    rb.push({ t: 11_000, v: 700 }); // +100 over 5s = 20/s
    expect(rb.deltas()).toEqual([
      { t: 6000, rate: 100 },
      { t: 11_000, rate: 20 },
    ]);
    expect(rb.latestRate()).toBe(20);
  });

  it("returns null rate when the counter goes backwards (server reset)", () => {
    const rb = new RingBuffer(10);
    rb.push({ t: 1000, v: 1000 });
    rb.push({ t: 6000, v: 5 }); // counter reset
    rb.push({ t: 11_000, v: 100 }); // resumes from low
    const deltas = rb.deltas();
    expect(deltas[0]?.rate).toBeNull();
    expect(deltas[1]?.rate).toBe(19); // (100-5)*1000/5000
    expect(rb.latestRate()).toBe(19);
  });

  it("returns null rate for zero-duration intervals", () => {
    const rb = new RingBuffer(5);
    rb.push({ t: 1000, v: 10 });
    rb.push({ t: 1000, v: 20 }); // same-instant duplicate
    expect(rb.deltas()[0]?.rate).toBeNull();
  });

  it("rejects out-of-order pushes without mutating the buffer", () => {
    const rb = new RingBuffer(10);
    rb.push({ t: 5000, v: 50 });
    expect(rb.push({ t: 1000, v: 10 })).toBe(false);
    expect(rb.size()).toBe(1);
    expect(rb.snapshot()).toEqual([{ t: 5000, v: 50 }]);
  });

  it("evicts oldest samples when capacity is exceeded (FIFO)", () => {
    const rb = new RingBuffer(3);
    rb.push({ t: 1000, v: 1 });
    rb.push({ t: 2000, v: 2 });
    rb.push({ t: 3000, v: 3 });
    rb.push({ t: 4000, v: 4 }); // evicts t=1000
    expect(rb.snapshot()).toEqual([
      { t: 2000, v: 2 },
      { t: 3000, v: 3 },
      { t: 4000, v: 4 },
    ]);
    expect(rb.size()).toBe(3);
  });

  it("clear() drops all samples", () => {
    const rb = new RingBuffer(5);
    rb.push({ t: 1000, v: 1 });
    rb.push({ t: 2000, v: 2 });
    rb.clear();
    expect(rb.size()).toBe(0);
    expect(rb.deltas()).toEqual([]);
    expect(rb.latestRate()).toBeNull();
  });

  it("snapshot() returns a defensive copy", () => {
    const rb = new RingBuffer(5);
    rb.push({ t: 1000, v: 10 });
    const snap = rb.snapshot() as Sample[];
    snap.push({ t: 2000, v: 20 });
    expect(rb.size()).toBe(1);
  });

  it("handles fractional rates", () => {
    const rb = new RingBuffer(5);
    rb.push({ t: 1000, v: 0 });
    rb.push({ t: 4000, v: 1 }); // +1 over 3s = 0.333.../s
    expect(rb.latestRate()).toBeCloseTo(1 / 3, 6);
  });
});

interface Sample {
  t: number;
  v: number;
}
