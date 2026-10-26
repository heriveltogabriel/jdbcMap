import type { Filters } from './domain/analysis';
import { emptyFilters } from './domain/analysis';
import type { PreviewInfo } from './domain/inventory';
import type { Catalog, Settings, Snapshot, SnapshotMeta } from './domain/types';
import type { Column } from './domain/flow';
import { DEFAULT_SETTINGS } from './storage/db';

export type Tab = 'map' | 'matrix' | 'plan' | 'data';

/** Arquivo lido e validado, à espera da confirmação do usuário. */
export interface PendingImport {
  fileName: string;
  json: unknown;
  info: PreviewInfo;
}

export interface Notice {
  kind: 'ok' | 'err' | 'info';
  text: string;
}

export interface State {
  tab: Tab;
  snapshots: SnapshotMeta[];
  current: Snapshot | null;
  catalog: Catalog;
  catalogText: string;
  catalogSimulated: boolean;
  settings: Settings;
  filters: Filters;
  showOs: boolean;
  showJdk: boolean;
  /** Nó destacado no mapa. */
  selection: { column: Column; key: string } | null;
  /** Linha da matriz selecionada para ver destinos de migração. */
  matrixSelection: string | null;
  pending: PendingImport | null;
  busy: string | null;
  notice: Notice | null;
  /** Qual limpeza está armada e espera a segunda confirmação. */
  armed: 'inventory' | 'catalog' | 'settings' | null;
}

export function initialState(): State {
  return {
    tab: 'map',
    snapshots: [],
    current: null,
    catalog: {},
    catalogText: '',
    catalogSimulated: false,
    settings: DEFAULT_SETTINGS,
    filters: emptyFilters(),
    showOs: true,
    showJdk: true,
    selection: null,
    matrixSelection: null,
    pending: null,
    busy: null,
    notice: null,
    armed: null,
  };
}
