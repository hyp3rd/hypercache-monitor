import type { MetricInfoContent } from "./metric-info";

/**
 * Centralized operator-facing copy for every tile, hero number,
 * and gauge on the /metrics page. Pulled into a single object so:
 *
 *   - Layout in `section-cards.tsx` stays focused on structure.
 *   - Copy iteration (clarity wording, alert thresholds, links to
 *     runbooks) happens in one file instead of being scattered.
 *   - TypeScript's `satisfies` clause means a typo in a tile's
 *     `info={metricInfo.foo}` reference is a compile-time error.
 *
 * Keys are tile-local identifiers, not raw `TrackedField` names —
 * the same counter can appear in two locations with different
 * framing (e.g. `hintedQueued` is "Queued" in the Hinted card
 * but could be referenced as `migrationHintQueuedDetail` if it
 * ever surfaced under Rebalance).
 *
 * Style guide for new entries:
 *
 *   - `what`: 1–2 sentences in plain language. Operators are
 *     senior engineers but may not have read the source. Avoid
 *     dashboard jargon ("the counter goes up when…").
 *   - `read`: optional, 1–2 sentences on interpretation —
 *     what "normal" looks like, what's worth investigating,
 *     which neighbouring metric to check next.
 *   - Never reference UI placement or React internals ("the tile
 *     to the left"). Copy survives layout reshuffles.
 */
export const metricInfo = {
  // -------- Traffic ---------------------------------------------

  forwardGet: {
    title: "Forward GET",
    what: "GETs forwarded to a remote owner because the receiving node isn't the primary for this key. Routing happens transparently inside the backend.",
    read: "Steady throughput is normal under any read load. A persistent rise relative to local hits often means clients are landing on a non-owner first — usually a routing / load-balancer wiring issue.",
  },

  forwardSet: {
    title: "Forward SET",
    what: "SETs forwarded to the primary owner of the key. The receiving node version-stamps and fans out to replicas.",
    read: "Tracks one-to-one with write traffic on non-primary nodes. Spikes followed by writeQuorumFailures usually mean a primary was unreachable mid-write — check Forward promotions.",
  },

  forwardRemove: {
    title: "Forward DELETE",
    what: "Deletes forwarded to the primary so the tombstone is applied at the owner and fans out to replicas.",
    read: "A delete on a non-primary must round-trip through the primary; a sudden divergence from forwardSet rates can indicate workload shift (e.g., TTL-driven purges).",
  },

  replicaFanoutSet: {
    title: "Replica fan-out SET",
    what: "SETs the primary replicated outward to other owners after applying locally.",
    read: "Should be approximately writeAttempts × (replicationFactor − 1). Persistent shortfall is a smoking gun for transport drops or hinted handoff absorbing failures.",
  },

  replicaFanoutRemove: {
    title: "Replica fan-out DELETE",
    what: "Deletes the primary replicated outward after applying locally.",
    read: "Mirrors replicaFanoutSet for delete traffic. Same diagnostic rule of thumb applies.",
  },

  replicaGetMiss: {
    title: "Replica GET miss",
    what: "Local-shard GETs that missed despite this node being a listed owner — typically the replica is behind on a recent write.",
    read: "Should track at near-zero. Persistent rise indicates replication lag or stale read-repair; check the hinted-handoff queue and merkle sync state.",
  },

  // -------- Reliability -----------------------------------------

  probeRate: {
    title: "Probe success rate",
    what: "Heartbeat probes that returned OK divided by total heartbeats issued. The cheap, always-on liveness signal.",
    read: "Healthy clusters live at 100% (less the occasional packet loss). A multi-minute dip on one peer escalates to a suspect→dead transition; flapping below 95% should page on-call.",
  },

  ackRate: {
    title: "Write quorum rate",
    what: "Successful Sets divided by Set attempts. Reflects the cluster's ability to satisfy the configured write-consistency level.",
    read: "Should stay above the SLO floor for your consistency setting. Dips correlate with primary unreachability — Forward promotions usually rise in tandem.",
  },

  heartbeatSuccess: {
    title: "Heartbeat success",
    what: "Periodic peer-liveness probes that returned OK. Drives the suspect/dead state machine.",
    read: "Compare to heartbeatFailure to derive probe rate. Total throughput should be ~ (peers − 1) × (1 / heartbeatInterval).",
  },

  heartbeatFailure: {
    title: "Heartbeat failure",
    what: "Periodic peer-liveness probes that timed out, errored, or were refused.",
    read: "A burst on one peer triggers a suspect transition; if it persists past deadAfter, the peer is removed from the ring. Cross-check with the membership card.",
  },

  indirectProbeSuccess: {
    title: "Indirect probe success",
    what: "Last-resort 3-hop probes (ask a third party to verify a peer) that confirmed the peer is reachable from someone else's vantage.",
    read: "A rise here often pairs with indirectProbeRefuted — your own network had a blip but the peer is fine. Use both together to filter heartbeat noise.",
  },

  indirectProbeFailure: {
    title: "Indirect probe failure",
    what: "3-hop probes that confirmed the peer is unreachable from multiple vantages — a stronger dead-signal than a single direct failure.",
    read: "When this rises, the peer is genuinely down rather than the local node having a transport issue. Combine with heartbeatFailure to triage.",
  },

  indirectProbeRefuted: {
    title: "Indirect probe refuted",
    what: "Indirect probes that refuted a direct-probe failure — a third party CAN reach the peer, so the local node's direct heartbeat must have been a false negative.",
    read: "Rising counts here are a saving grace — they're the dashboard's way of telling you 'flap suppressed.' Persistent rise often means asymmetric routing in the network.",
  },

  writeQuorumFailures: {
    title: "Write quorum failures",
    what: "Sets that didn't reach the required ack count under the configured write consistency. Surface as sentinel.ErrQuorumFailed to the caller.",
    read: "Should be near-zero. Sustained rise indicates a peer outage that's eating into available replicas — combine with the membership gauges to identify which node.",
  },

  writeForwardPromotion: {
    title: "Forward promotions",
    what: "Set/Remove attempts where the local replica self-promoted because the primary was unreachable. The cluster routes around the dead primary without dropping the write.",
    read: "Rising sparkline = a primary is flapping. Surfaces BEFORE writeQuorumFailures climb because promotion absorbs the failure. Triage: combine with heartbeatFailure on the suspect peer.",
  },

  // -------- Repair & drift --------------------------------------

  coalesceRatio: {
    title: "Read-repair coalesce ratio",
    what: "When WithDistReadRepairBatch is enabled, this is the fraction of read-repair enqueues that were collapsed by the coalescer because a same-version-or-higher entry was already pending.",
    read: "Higher = bigger amortisation win. Hot keys with stable values pin this near 100%. Stays at zero when batching isn't configured (the option is opt-in).",
  },

  readRepair: {
    title: "Read repair",
    what: "Read-path fan-outs that detected a stale replica and dispatched a corrective ForwardSet. Best-effort — failures don't propagate to the read caller.",
    read: "Steady low rate is healthy (catches replicas drifting between merkle ticks). A sudden surge often means a peer just rejoined and is being caught up.",
  },

  readRepairBatched: {
    title: "Read repair (batched)",
    what: "Subset of read-repair calls dispatched via the async coalescer queue (WithDistReadRepairBatch). Each bump represents one actual ForwardSet on the wire.",
    read: "The ratio readRepairBatched / readRepair shows what fraction of repair traffic is going through the queue. Operators tuning the interval/maxBatchSize knob watch this to confirm the batched path is engaged.",
  },

  readRepairCoalesced: {
    title: "Read repair (coalesced)",
    what: "Duplicate (peer, key) enqueues that the coalescer collapsed before they hit the wire. Each bump is one ForwardSet the cluster didn't need to send.",
    read: "Direct measurement of the amortisation. Concurrent reads of the same hot key drive this up; flat key distributions leave it low even with batching enabled.",
  },

  merkleSyncs: {
    title: "Merkle syncs",
    what: "Completed anti-entropy sync passes against peers. Each pass compares merkle trees and pulls divergent keys.",
    read: "Frequency depends on WithDistMerkleAutoSync. Sustained zero with autosync enabled means the peer probe is failing — check Last auto-sync error.",
  },

  merkleKeysPulled: {
    title: "Merkle keys pulled",
    what: "Keys applied to the local shard during anti-entropy sync — divergent values fetched from the peer that this node was missing or behind on.",
    read: "Spikes after a peer rejoin are expected. Persistent non-zero during steady state indicates ongoing replica drift; check transport health.",
  },

  autoSyncLoops: {
    title: "Auto-sync loops",
    what: "Iterations of the background auto-sync scheduler. Each loop probes a peer subset and possibly triggers a merkleSync.",
    read: "Tick frequency reflects the configured interval. A flat counter with no merkleSyncs means the loop is running but every peer matched — convergence is steady.",
  },

  tombstonesActive: {
    title: "Tombstones active",
    what: "Tombstones currently retained in memory so that delete-replay (hinted handoff, anti-entropy) can correctly suppress resurrected writes.",
    read: "Grows after delete-heavy traffic, shrinks as entries age past their retention window. Persistent growth indicates either a delete spike or the purge loop is stuck.",
  },

  tombstonesPurged: {
    title: "Tombstones purged",
    what: "Tombstones aged out past their retention window and removed from memory by the purge loop.",
    read: "Healthy steady state has this approximately matching the inbound delete rate, with a lag equal to retention window. Sustained shortfall vs. tombstonesActive is a memory leak signal.",
  },

  versionConflicts: {
    title: "Version conflicts",
    what: "Divergent (version, origin) pairs detected during reconciliation — typically after a network partition heals.",
    read: "Near-zero in normal operation. A burst right after a split-brain heal is expected; sustained non-zero means clocks or version counters are drifting.",
  },

  versionTieBreaks: {
    title: "Version tie-breaks",
    what: "Same-version, different-origin pairs resolved via origin-string tie-break. Always-deterministic last-write-wins.",
    read: "Most commonly fires when two nodes wrote the same key in the same logical tick (rare). Not concerning unless the rate is high — then investigate client-side concurrent-writer patterns.",
  },

  readPrimaryPromote: {
    title: "Read primary promote",
    what: "Get-path outcomes where the data came from a non-primary owner (primary was unreachable or missing the key). Operationally similar to writeForwardPromotion but for reads.",
    read: "Climbs during primary flapping. Pair with the membership gauges and writeForwardPromotion to confirm the same peer is the culprit on both axes.",
  },

  // -------- Membership ------------------------------------------

  membersAlive: {
    title: "Members alive",
    what: "Peers in the alive state per the local node's view of membership. Updated by heartbeat success / indirect probes.",
    read: "Should equal the configured cluster size minus any deliberate drains. Drops correlate with deploy windows or genuine outages.",
  },

  membersSuspect: {
    title: "Members suspect",
    what: "Peers we believe are unreachable but haven't confirmed dead yet — they're inside the suspect window, awaiting deadAfter or an indirect probe refutation.",
    read: "Brief excursions during normal heartbeat jitter are fine. Persistent non-zero indicates a peer is on the edge — check the heartbeat counters.",
  },

  membersDead: {
    title: "Members dead",
    what: "Peers heartbeat-confirmed dead and removed from the ring's owner-lookup logic. New writes won't target them; hints accumulate for their restart.",
    read: "Non-zero is a page-on-call signal unless you intentionally took a node down. The peer must be either restarted or explicitly removed from membership to clean this up.",
  },

  membershipVersion: {
    title: "Membership version",
    what: "Monotonic counter that increments on every membership state change (add, remove, state transition). Used to gossip-version the cluster view.",
    read: "Stable in steady state. Bumps after deploys/restarts are expected. Rapidly advancing without operator action means peers are flapping.",
  },

  drains: {
    title: "Drains",
    what: "POSTs to /dist/drain received by this node. Drain returns 503 on /health so external load balancers stop routing.",
    read: "Bumps exactly once per drain. Useful audit log: chart vs. deploys to confirm graceful shutdown is being invoked.",
  },

  nodesRemoved: {
    title: "Nodes removed",
    what: "Peers explicitly removed from membership — either via DistMemory.RemovePeer or after exceeding the deadAfter window.",
    read: "Spikes during deploys. Should converge back to a flat curve after deploy completes. Persistent advancement = your cluster is shedding peers it can't reach.",
  },

  // -------- Hinted handoff --------------------------------------

  retentionRate: {
    title: "Hint retention rate",
    what: "Hints successfully replayed divided by total hints that terminated (replayed + expired). Measures how often a queued write actually reaches its destination before the TTL window closes.",
    read: "Healthy clusters live above 95% — TTL is generous and outages are short. Drops indicate peers were down longer than WithDistHintTTL; consider raising the TTL or investigating peer recovery time.",
  },

  bytesQueued: {
    title: "Bytes queued",
    what: "Total bytes currently held in the hint queue across all destination peers, pending replay.",
    read: "Rises while a peer is unreachable; should drain to zero shortly after the peer recovers. Sustained growth without recovery is a leading indicator of the global cap being hit.",
  },

  hintedQueued: {
    title: "Hinted queued",
    what: "Write attempts queued for a temporarily-unreachable peer. The replay loop dispatches them on its configured interval once the peer responds.",
    read: "Expected during peer outages. Should converge to a stable count, then drop as Replayed catches up. Continuous rise means writes are arriving faster than the peer can recover.",
  },

  hintedReplayed: {
    title: "Hinted replayed",
    what: "Queued hints successfully delivered to the destination peer after it became reachable again.",
    read: "Total throughput on this counter should roughly match Hinted queued over a long enough window. Lag = peer recovery time.",
  },

  hintedExpired: {
    title: "Hinted expired",
    what: "Hints that hit their TTL before the destination peer became reachable. The cluster falls back to merkle anti-entropy for these keys.",
    read: "Non-zero means a peer was down longer than WithDistHintTTL. If this is acceptable (anti-entropy will heal), no action. Otherwise raise the TTL.",
  },

  hintedDropped: {
    title: "Hinted dropped (per node)",
    what: "Legacy counter — previously bumped when a hint replay failed with an error other than ErrBackendNotFound. The current implementation retains on any error and lets TTL handle abandonment, so this stays at zero.",
    read: "Should always read zero on a current build. Kept registered for OTel-time-series continuity; future restoration would require a permanent-failure sentinel taxonomy.",
  },

  hintedGlobalDropped: {
    title: "Hinted dropped (global)",
    what: "Hints rejected at queue time because the global byte / count caps (WithDistHintMaxTotal, WithDistHintMaxBytes) were already saturated.",
    read: "Non-zero is a capacity-planning signal: either a peer has been down so long that hint accumulation crossed the cap, or write traffic exceeds the cap's headroom. Raise caps or fix the upstream peer.",
  },

  hintedBytes: {
    title: "Bytes flowing",
    what: "Approximate byte size of queued hints, exposed as a rate-sampled gauge so the sparkline reflects queue depth dynamics.",
    read: "Useful as a sparkline of pressure. Sustained rise without Hinted replayed catching up is the classic backlog pattern.",
  },

  migrationHintQueued: {
    title: "Migration · queued",
    what: "Subset of Hinted queued attributable to rebalance migrations specifically (a new primary that wasn't reachable when this node tried to hand off ownership).",
    read: "Bumps during rebalance ticks involving an unreachable target. Should track to zero as the new primary comes online and the migration replay loop fires.",
  },

  migrationHintReplayed: {
    title: "Migration · replayed",
    what: "Migration hints successfully delivered after the new primary became reachable.",
    read: "Catches up after a delay equal to the new primary's startup time. Compare to migrationHintQueued for the rebalance-replay throughput.",
  },

  migrationHintExpired: {
    title: "Migration · expired",
    what: "Migration hints that aged out before the new primary became reachable. Merkle anti-entropy will reconcile these keys on a slower schedule.",
    read: "Non-zero means a rebalance happened against a peer that took longer than WithDistHintTTL to come online. Increase the TTL or investigate startup delays.",
  },

  migrationHintDropped: {
    title: "Migration · dropped",
    what: "Migration hints dropped at queue time because the global queue caps were saturated.",
    read: "Same diagnostic as Hinted dropped (global), but specific to rebalance-source hints. Raising caps mid-rebalance is reasonable; auditing why the cap fills is the longer fix.",
  },

  // -------- Rebalance -------------------------------------------

  rebalancedKeys: {
    title: "Keys rebalanced",
    what: "Keys whose ownership migrated during a rebalance pass — either the primary changed or a replica set was added/removed.",
    read: "Spikes during membership changes. Steady state should be zero. The total across a rebalance equals approximately (affected-keys × ownership-deltas).",
  },

  rebalanceBatches: {
    title: "Batches",
    what: "Full rebalance batches completed. The rebalance loop scans owned keys in batches sized by WithDistRebalanceBatchSize.",
    read: "Bumps once per rebalance tick. Use as a heartbeat for the rebalance loop — a stalled counter while membership keeps changing means the loop wedged.",
  },

  rebalancedPrimary: {
    title: "Primary migrations",
    what: "Keys whose primary ownership flipped to this node during rebalance. Triggers a fetch from the previous primary plus replica fan-out.",
    read: "Spikes during node add/remove. The fetch traffic is visible on Merkle keys pulled; replication on Replica fan-out SET.",
  },

  rebalancedReplicaDiff: {
    title: "Replica diff",
    what: "Keys whose replica set changed without the primary moving — typically when a new node joins and takes a replica slot from another node.",
    read: "Smaller, lower-impact than primary migrations: the data still lives on the same primary, only the replica copy gets refreshed.",
  },

  // -------- Chaos ----------------------------------------------

  chaosDrops: {
    title: "Transport drops",
    what: "Transport calls dropped by the chaos wrapper (WithDistChaos). Test/staging only — production clusters should see zero here unless chaos exercises are running.",
    read: "Non-zero means a chaos run is active. Use to validate that hinted handoff, read-repair, and promotion are absorbing the injected failures.",
  },

  chaosLatencies: {
    title: "Injected latencies",
    what: "Transport calls that had artificial latency injected by the chaos wrapper.",
    read: "Use to verify that timeouts, write quorum, and indirect probes degrade gracefully under realistic tail-latency conditions.",
  },
} as const satisfies Record<string, MetricInfoContent>;
