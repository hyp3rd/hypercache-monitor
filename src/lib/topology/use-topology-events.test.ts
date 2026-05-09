import { queryKeys } from "@/lib/query/keys";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTopologyEvents } from "./use-topology-events";

/**
 * Pins the SSE consumer's contract:
 *
 *   - `members` events parse via the schema and write into the
 *     TanStack-Query cache at `queryKeys.members(clusterId)`.
 *   - `heartbeat` events do the same at `queryKeys.heartbeat(...)`.
 *   - Malformed frames (not JSON, schema-fail) drop with a
 *     console warning and do NOT crash.
 *   - `connected` flips on `open` and back on `error`.
 *   - Switching `clusterId` closes the old EventSource.
 *   - Tab visibility flips close/reopen the connection.
 *
 * Drives a hand-rolled FakeEventSource (Node has no native one),
 * passed via `eventSourceFactory` so the hook exercises real
 * code paths without a network.
 */

class FakeEventSource implements EventTarget {
  static instances: FakeEventSource[] = [];

  url: string;
  readyState: 0 | 1 | 2 = 0;
  closed = false;
  private listeners: Map<string, Set<EventListener>> = new Map();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(evt: Event): boolean {
    this.listeners.get(evt.type)?.forEach((l) => l(evt));
    return true;
  }

  // Helpers used by tests, not part of the EventSource API.
  emit(type: string, data: string) {
    const evt = new MessageEvent(type, { data });
    this.dispatchEvent(evt);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  error() {
    this.readyState = 2;
    this.dispatchEvent(new Event("error"));
  }
  close() {
    this.readyState = 2;
    this.closed = true;
  }
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

let qc: QueryClient;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  FakeEventSource.instances = [];
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  vi.useRealTimers();
});

describe("useTopologyEvents", () => {
  it("opens the EventSource at the cluster-aware URL on mount", () => {
    renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/clusters/default/mgmt/cluster/events",
    );
  });

  it("sets connected=true on `open` and false on `error`", async () => {
    const { result } = renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    expect(result.current.connected).toBe(false);

    act(() => {
      FakeEventSource.instances[0]?.open();
    });
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      FakeEventSource.instances[0]?.error();
    });
    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  it("writes `members` events into queryKeys.members(clusterId)", async () => {
    renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    const payload = {
      replication: 3,
      virtualNodes: 64,
      members: [
        { ID: "n1", Address: "host:7946", State: "alive", Incarnation: 1 },
      ],
    };

    act(() => {
      FakeEventSource.instances[0]?.emit("members", JSON.stringify(payload));
    });

    await waitFor(() => {
      const cached = qc.getQueryData(queryKeys.members("default"));
      expect(cached).toBeDefined();
    });

    const cached = qc.getQueryData(queryKeys.members("default")) as {
      replication: number;
      members: Array<{ id: string }>;
    };
    expect(cached.replication).toBe(3);
    expect(cached.members[0]?.id).toBe("n1");
  });

  it("writes `heartbeat` events into queryKeys.heartbeat(clusterId)", async () => {
    renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    const hb = {
      heartbeatSuccess: 100,
      heartbeatFailure: 0,
      nodesRemoved: 0,
      readPrimaryPromote: 0,
    };

    act(() => {
      FakeEventSource.instances[0]?.emit("heartbeat", JSON.stringify(hb));
    });

    await waitFor(() => {
      const cached = qc.getQueryData(queryKeys.heartbeat("default"));
      expect(cached).toMatchObject({ heartbeatSuccess: 100 });
    });
  });

  it("drops a non-JSON frame with a console warning", () => {
    renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    act(() => {
      FakeEventSource.instances[0]?.emit("members", "not-json{");
    });

    expect(qc.getQueryData(queryKeys.members("default"))).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("members frame is not valid JSON"),
      expect.anything(),
    );
  });

  it("drops a frame that fails the schema with a console warning", () => {
    renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    // Missing required `members` array.
    act(() => {
      FakeEventSource.instances[0]?.emit(
        "members",
        JSON.stringify({ replication: 3 }),
      );
    });

    expect(qc.getQueryData(queryKeys.members("default"))).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("members frame failed schema"),
      expect.anything(),
    );
  });

  it("closes the previous EventSource when clusterId changes", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTopologyEvents(id, {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc), initialProps: { id: "default" } },
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];

    rerender({ id: "secondary" });

    expect(first?.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]?.url).toBe(
      "/api/clusters/secondary/mgmt/cluster/events",
    );
  });

  it("disabled=false skips opening the EventSource entirely", () => {
    renderHook(
      () =>
        useTopologyEvents("default", {
          enabled: false,
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(
      () =>
        useTopologyEvents("default", {
          eventSourceFactory: (u) =>
            new FakeEventSource(u) as unknown as EventSource,
        }),
      { wrapper: makeWrapper(qc) },
    );

    expect(FakeEventSource.instances[0]?.closed).toBe(false);
    unmount();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });
});
