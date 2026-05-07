/**
 * Fixed-capacity ring buffer of `(timestamp, value)` samples,
 * tailored for the Phase B2 metrics dashboard's needs:
 *
 *   - cumulative counters (`/dist/metrics`) → rate-of-change
 *     sparklines. The buffer keeps the last N samples; the
 *     consumer asks for "delta per second over the last window"
 *     and gets a single number plus a timeline for plotting.
 *
 *   - state survives the lifetime of one tab. Refresh resets
 *     the chart — that's the operator-mental-model match (per
 *     the B2 design Q&A: ring buffer ephemeral, in-memory only).
 *
 * The implementation is a plain class with no React, no signals,
 * no observers — just a typed FIFO. The hook layer
 * (`useRingBufferStore`) wraps it for React consumption.
 *
 * Counter-reset handling: when a new sample's value is *less*
 * than the previous sample's value, the counter has been reset
 * server-side (cache restart, node replacement). We treat that
 * as a discontinuity — the delta over the affected interval is
 * `null`, not a large negative number that would stretch the
 * chart's Y-axis to absurd values. Charts skip null points.
 */

export interface Sample {
  /** Unix epoch milliseconds. Caller decides time source — usually `Date.now()`. */
  t: number;
  /** Cumulative counter value at time `t`. */
  v: number;
}

export interface DeltaPoint {
  /** Right-edge timestamp of the interval (the newer sample's `t`). */
  t: number;
  /**
   * Per-second delta: (v_new - v_old) / ((t_new - t_old) / 1000).
   * `null` when the counter went backwards (server reset) or
   * when the interval is too short to compute meaningfully.
   */
  rate: number | null;
}

export class RingBuffer {
  private samples: Sample[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      // Capacity < 2 makes deltas impossible — a single sample
      // can't have a rate. Throwing here surfaces caller bugs
      // immediately instead of returning silently-empty rates.
      throw new Error(`RingBuffer capacity must be an integer >= 2, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  /**
   * Append a sample. If the buffer is full, the oldest sample is
   * dropped. Samples MUST arrive in non-decreasing timestamp
   * order; out-of-order pushes are rejected (return false) so
   * a clock-skew bug surfaces loud rather than silently
   * producing negative-time deltas downstream.
   */
  push(sample: Sample): boolean {
    const last = this.samples[this.samples.length - 1];
    if (last !== undefined && sample.t < last.t) {
      return false;
    }
    this.samples.push(sample);
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
    return true;
  }

  /** Count of samples currently held. */
  size(): number {
    return this.samples.length;
  }

  /** Drop everything. Used on cluster switch (Phase C) and tests. */
  clear(): void {
    this.samples = [];
  }

  /** Snapshot of current samples in chronological order. */
  snapshot(): readonly Sample[] {
    return this.samples.slice();
  }

  /**
   * Per-second deltas between consecutive samples. Length is
   * `size() - 1` — a buffer with N samples produces N-1 rates.
   * Counter resets surface as `rate: null` rather than a
   * negative number; chart libraries (Recharts included) treat
   * null as a gap.
   */
  deltas(): DeltaPoint[] {
    const out: DeltaPoint[] = [];
    for (let i = 1; i < this.samples.length; i++) {
      const prev = this.samples[i - 1]!;
      const curr = this.samples[i]!;
      const dtMs = curr.t - prev.t;
      if (dtMs <= 0) {
        // Same-instant duplicate samples (shouldn't happen but
        // we don't crash if they do) — emit null to keep the
        // timeline contiguous.
        out.push({ t: curr.t, rate: null });
        continue;
      }
      if (curr.v < prev.v) {
        // Counter reset / server restart.
        out.push({ t: curr.t, rate: null });
        continue;
      }
      out.push({ t: curr.t, rate: ((curr.v - prev.v) * 1000) / dtMs });
    }
    return out;
  }

  /**
   * Most-recent per-second rate, or `null` when there aren't
   * yet two samples to compare. The hero number on each rate
   * card binds to this.
   */
  latestRate(): number | null {
    if (this.samples.length < 2) return null;
    const last = this.samples[this.samples.length - 1]!;
    const prev = this.samples[this.samples.length - 2]!;
    const dtMs = last.t - prev.t;
    if (dtMs <= 0) return null;
    if (last.v < prev.v) return null;
    return ((last.v - prev.v) * 1000) / dtMs;
  }
}
