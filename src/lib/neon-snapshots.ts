/**
 * Minimal Neon API client for snapshot rotation.
 *
 * WHY ROTATION AND NOT JUST "CREATE": the project is on Neon's **Free** plan, which allows exactly
 * ONE manual snapshot. The console offers "Upgrade for more snapshots" the moment a second is
 * attempted. So a recurring snapshot must delete the previous one first — and that ordering is the
 * whole reason `checkDbHealth()` gates this.
 *
 * ⚠️ Requires `NEON_API_KEY`. There is no key in the environment today; the route refuses loudly
 * rather than reporting success while doing nothing.
 */
const API = 'https://console.neon.tech/api/v2';

export type NeonSnapshot = { id: string; name?: string; created_at?: string };

function headers(key: string) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function call<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers(key) });
  if (!res.ok) {
    // Include the body — Neon puts the actionable part there (plan limits, bad branch id).
    throw new Error(`Neon ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function listSnapshots(
  key: string,
  projectId: string,
  branchId: string,
): Promise<NeonSnapshot[]> {
  const d = await call<{ snapshots?: NeonSnapshot[] }>(
    key,
    `/projects/${projectId}/branches/${branchId}/snapshots`,
  );
  return d.snapshots ?? [];
}

export async function deleteSnapshot(key: string, projectId: string, snapshotId: string) {
  await call(key, `/projects/${projectId}/snapshots/${snapshotId}`, { method: 'DELETE' });
}

export async function createSnapshot(
  key: string,
  projectId: string,
  branchId: string,
  name: string,
): Promise<NeonSnapshot> {
  const d = await call<{ snapshot: NeonSnapshot }>(
    key,
    `/projects/${projectId}/branches/${branchId}/snapshot?name=${encodeURIComponent(name)}`,
    { method: 'POST' },
  );
  return d.snapshot;
}
