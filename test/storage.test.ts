import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/domain/inventory';
import type { Snapshot } from '../src/domain/types';
import {
  DEFAULT_SETTINGS, clearCatalog, deleteSnapshot, clearInventory, getCatalog, getSettings, getSnapshot, listSnapshots, openStore, resetSettings, saveCatalog, saveSettings, saveSnapshot,
  type Store,
} from '../src/storage/db';
import { syntheticExport } from './fixtures';

function snapshotAt(exportedAt: string): Snapshot {
  const json = syntheticExport();
  json.metadata.exportedAt = exportedAt;
  return buildSnapshot(json, { importedAt: '2026-10-26T13:00:00Z' });
}

let store: Store;
let counter = 0;
beforeEach(async () => {
  store = await openStore(`teste-${counter++}`);
});

describe('importar e limpar', () => {
  it('substituir apaga as coletas anteriores', async () => {
    await saveSnapshot(store, snapshotAt('2026-10-20T00:00:00Z'), { replace: true, keep: 5 });
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: true, keep: 5 });
    const list = await listSnapshots(store);
    expect(list.map((s) => s.id)).toEqual(['2026-10-26T00:00:00Z']);
  });
  it('acumular guarda as mais recentes até o limite', async () => {
    for (const day of ['20', '21', '22', '23']) await saveSnapshot(store, snapshotAt(`2026-10-${day}T00:00:00Z`), { replace: false, keep: 3 });
    const ids = (await listSnapshots(store)).map((s) => s.id);
    expect(ids).toEqual(['2026-10-23T00:00:00Z', '2026-10-22T00:00:00Z', '2026-10-21T00:00:00Z']);
  });
  it('remover uma coleta deixa as demais', async () => {
    await saveSnapshot(store, snapshotAt('2026-10-20T00:00:00Z'), { replace: false, keep: 5 });
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: false, keep: 5 });
    await deleteSnapshot(store, '2026-10-20T00:00:00Z');
    expect((await listSnapshots(store)).map((s) => s.id)).toEqual(['2026-10-26T00:00:00Z']);
  });
  it('importar o mesmo arquivo de novo não duplica', async () => {
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: false, keep: 5 });
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: false, keep: 5 });
    expect(await listSnapshots(store)).toHaveLength(1);
  });
  it('a listagem não carrega os fatos, mas o snapshot completo sim', async () => {
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: true, keep: 5 });
    const [meta] = await listSnapshots(store);
    expect(meta).not.toHaveProperty('facts');
    expect((await getSnapshot(store, '2026-10-26T00:00:00Z'))?.facts.length).toBe(4);
  });
  it('limpar o inventário preserva o catálogo e as configurações', async () => {
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: true, keep: 5 });
    await saveCatalog(store, { dbscan1: '19c' });
    await saveSettings(store, { ...DEFAULT_SETTINGS, keepSnapshots: 9 });
    await clearInventory(store);
    expect(await listSnapshots(store)).toEqual([]);
    expect(await getCatalog(store)).toEqual({ dbscan1: '19c' });
    expect((await getSettings(store)).keepSnapshots).toBe(9);
  });
});

describe('catálogo e configurações', () => {
  it('salvar troca o catálogo inteiro', async () => {
    await saveCatalog(store, { a: '19c', b: '12c' });
    await saveCatalog(store, { c: '21c' });
    expect(await getCatalog(store)).toEqual({ c: '21c' });
  });
  it('limpar o catálogo não toca nas coletas', async () => {
    await saveSnapshot(store, snapshotAt('2026-10-26T00:00:00Z'), { replace: true, keep: 5 });
    await saveCatalog(store, { a: '19c' });
    await clearCatalog(store);
    expect(await getCatalog(store)).toEqual({});
    expect(await listSnapshots(store)).toHaveLength(1);
  });
  it('as configurações voltam ao padrão', async () => {
    expect(await getSettings(store)).toEqual(DEFAULT_SETTINGS);
    await saveSettings(store, { ...DEFAULT_SETTINGS, keepSnapshots: 2 });
    await resetSettings(store);
    expect(await getSettings(store)).toEqual(DEFAULT_SETTINGS);
  });
});
