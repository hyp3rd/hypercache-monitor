/**
 * Cluster types shared between server and client. Server reads
 * the cluster's `apiBaseUrl` and `mgmtBaseUrl`; client only
 * sees `id` and `name` (rendered in the picker / topbar).
 */

export interface Cluster {
  id: string;
  name: string;
  apiBaseUrl: string;
  mgmtBaseUrl: string;
}

/**
 * ClusterListItem is the client-facing projection of `Cluster`
 * — strips the URLs because the browser must never address the
 * cache directly (it goes through `/api/clusters/[clusterId]/...`).
 */
export interface ClusterListItem {
  id: string;
  name: string;
}

export function toListItem(c: Cluster): ClusterListItem {
  return { id: c.id, name: c.name };
}
