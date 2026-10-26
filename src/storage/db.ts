import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_ENV_RULE } from '../rules/env';
import type { Catalog, Settings, Snapshot, SnapshotMeta } from '../domain/types';

interface JdbcMapDb extends DBSchema {
  /** Um registro por coleta importada, com os fatos dentro. */
  snapshots: { key: string; value: Snapshot; indexes: { exportedAt: string } };
  /** Catálogo de versões dos bancos: independe de qualquer coleta. */
  catalog: { key: string; value: { host: string; version: Catalog[string] } };
  /** Configurações (regra de ambiente, quantos snapshots guardar). */
  settings: { key: string; value: { key: string; value: unknown } };
}

export const DB_NAME = 'jdbcmap';
export const DEFAULT_SETTINGS: Settings = { envRule: DEFAULT_ENV_RULE, keepSnapshots: 5 };

export type Store = IDBPDatabase<JdbcMapDb>;

export async function openStore(name = DB_NAME): Promise<Store> {
  return openDB<JdbcMapDb>(name, 1, {
    upgrade(db) {
      const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
      snapshots.createIndex('exportedAt', 'exportedAt');
      db.createObjectStore('catalog', { keyPath: 'host' });
      db.createObjectStore('settings', { keyPath: 'key' });
    },
  });
}

/** Salva a coleta. Com `replace`, apaga as anteriores; senão mantém as `keep` mais recentes (por data de exportação). */
export async function saveSnapshot(store: Store, snapshot: Snapshot, options: { replace: boolean; keep: number }): Promise<void> {
  const tx = store.transaction('snapshots', 'readwrite');
  if (options.replace) await tx.store.clear();
  await tx.store.put(snapshot);
  const keys = await tx.store.index('exportedAt').getAllKeys();
  const excess = options.replace ? 0 : keys.length - Math.max(1, options.keep);
  for (let i = 0; i < excess; i++) {
    const oldest = keys[i];
    if (oldest !== undefined) await tx.store.delete(oldest);
  }
  await tx.done;
}

/** Metadados de todas as coletas, da mais recente para a mais antiga, sem os fatos. */
export async function listSnapshots(store: Store): Promise<SnapshotMeta[]> {
  const all = await store.getAll('snapshots');
  return all
    .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
    .map(({ facts: _facts, ...meta }) => meta);
}

export async function getSnapshot(store: Store, id: string): Promise<Snapshot | undefined> {
  return store.get('snapshots', id);
}

export async function deleteSnapshot(store: Store, id: string): Promise<void> {
  await store.delete('snapshots', id);
}

/** Limpa só os inventários; catálogo e configurações permanecem. */
export async function clearInventory(store: Store): Promise<void> {
  await store.clear('snapshots');
}

export async function getCatalog(store: Store): Promise<Catalog> {
  const catalog: Catalog = {};
  for (const entry of await store.getAll('catalog')) catalog[entry.host] = entry.version;
  return catalog;
}

/** Troca o catálogo inteiro pelo informado. */
export async function saveCatalog(store: Store, catalog: Catalog): Promise<void> {
  const tx = store.transaction('catalog', 'readwrite');
  await tx.store.clear();
  for (const [host, version] of Object.entries(catalog)) await tx.store.put({ host, version });
  await tx.done;
}

export async function clearCatalog(store: Store): Promise<void> {
  await store.clear('catalog');
}

export async function getSettings(store: Store): Promise<Settings> {
  const saved = await store.get('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...((saved?.value as Partial<Settings> | undefined) ?? {}) };
}

export async function saveSettings(store: Store, settings: Settings): Promise<void> {
  await store.put('settings', { key: 'app', value: settings });
}

/** Volta as regras (ambiente e retenção) ao padrão. */
export async function resetSettings(store: Store): Promise<void> {
  await store.delete('settings', 'app');
}
