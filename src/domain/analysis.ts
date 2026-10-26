import { DB_VERSIONS, DRIVER_LINES, MATRIX_ROWS, compatOf, type MatrixRow } from '../rules/compat';
import type { Catalog, DbVersion, DriverLine, Fact, Status } from './types';

/** Linha do driver Oracle a partir da versão do jar; null quando não é um driver Oracle reconhecível. */
export function driverLine(version: string | null | undefined): DriverLine | null {
  if (!version) return null;
  if ((/^1\./.test(version) || /redhat|wls/i.test(version)) && !/^1[12]\./.test(version)) return null;
  const [major, minor] = version.split('.').map((part) => parseInt(part, 10));
  if (major === undefined || Number.isNaN(major)) return null;
  if (major === 11) return '11.2';
  if (major === 12) return (minor ?? 0) >= 2 ? '12.2' : '12.1';
  if (major === 18) return '18';
  if (major === 19) return '19';
  if (major === 21) return '21';
  if (major === 23) return (minor ?? 0) >= 26 ? '26' : '23';
  if (major > 23) return '26';
  return null;
}

/** Versão principal do JDK (1.8.0_251 → 8, 17.0.7 → 17). */
export function jdkMajor(version: string | null | undefined): number | null {
  if (!version) return null;
  const match = /^1\.(\d+)/.exec(version) ?? /^(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

/** Normaliza o texto de versão do banco ("19c", "Oracle 12.2", "11.2.0.4") para a coluna da matriz. */
export function normalizeDbVersion(text: string | null | undefined): DbVersion | null {
  const match = /(\d+)(?:\.(\d+))?/.exec((text ?? '').toLowerCase().replace(/\s/g, ''));
  if (!match) return null;
  const major = Number(match[1]);
  if (major === 11) return '11g';
  if (major === 12) return '12c';
  if (major === 18) return '18c';
  if (major === 19) return '19c';
  if (major === 21) return '21c';
  if (major === 23) return '23ai';
  if (major >= 24) return '26ai';
  return null;
}

/** Nome curto do host do banco (primeiro rótulo do FQDN), ou o IP inteiro. */
export function shortHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const trimmed = host.trim();
  return /^\d+(\.\d+){3}$/.test(trimmed) ? trimmed : (trimmed.split('.')[0] ?? null);
}

export interface CatalogParse {
  catalog: Catalog;
  /** Linhas ignoradas, com o número da linha (1 = primeira). */
  rejected: { line: number; text: string }[];
}

/** Lê linhas `host;versão` (também aceita vírgula ou tab). */
export function parseCatalog(text: string): CatalogParse {
  const catalog: Catalog = {};
  const rejected: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [host, version] = line.split(/[;,\t]/);
    const key = shortHost(host);
    const normalized = normalizeDbVersion(version);
    if (key && normalized) catalog[key] = normalized;
    else rejected.push({ line: index + 1, text: line });
  });
  return { catalog, rejected };
}

/** Situação de uma conexão: compatibilidade do driver com a versão do banco, ou unk sem driver/versão. */
export function statusOf(fact: Fact, catalog: Catalog): Status {
  const line = driverLine(fact.driverVersion);
  if (!line) return 'unk';
  const key = shortHost(fact.dbHost);
  const db = key ? catalog[key] : undefined;
  return db ? compatOf(line, db) : 'unk';
}

/** Linha da matriz (jar + release) onde a conexão está hoje. */
export function matrixRowOf(fact: Fact): MatrixRow | null {
  const line = driverLine(fact.driverVersion);
  if (!line) return null;
  const exact = MATRIX_ROWS.find((row) => row.id === `${fact.jar ?? ''}|${line}`);
  return exact ?? MATRIX_ROWS.find((row) => row.line === line) ?? null;
}

/** Sugestão de migração textual para uma conexão, ou null quando não há o que sugerir. */
export function suggest(fact: Fact, catalog: Catalog): string | null {
  const line = driverLine(fact.driverVersion);
  if (!line) return null;
  const db = catalog[shortHost(fact.dbHost) ?? ''];
  const jdk = jdkMajor(fact.jdk);
  const jar = jdk === null || jdk <= 8 ? 'ojdbc8' : jdk <= 11 ? 'ojdbc11' : 'ojdbc17';
  const old = line === '11.2' || line === '12.1' || line === '12.2' || line === '18';
  if (!db) {
    return old ? 'Migrar para ojdbc8 19.x (roda de JDK 8 a 21 e é certificado com 19c, 21c e 26ai). Informe a versão do banco para confirmar.' : null;
  }
  const status = statusOf(fact, catalog);
  if (status === 'ok') return null;
  if (status === 'nv') return `Combinação não verificada nas docs da Oracle (driver ${line} com banco ${db}). Conferir antes de decidir.`;
  const high = db === '21c' || db === '23ai' || db === '26ai';
  const target = high ? `${jar} 26ai/23.26+ (certificado com 19c, 21c e 26ai)` : 'ojdbc8 19.x (certificado com 19c, 21c e 26ai)';
  if (status === 'bad') return `Trocar o driver: a Oracle não lista este driver com o banco ${db}. Usar ${target}.`;
  return `Combinação em “Was” (uma versão fora do suporte). Alinhar para ${target}${/^(11|12|18)/.test(db) ? ' e planejar a atualização do banco' : ''}.`;
}

export const RANGES: readonly { label: string; lines: readonly DriverLine[] }[] = [
  { label: '≤ 11.2', lines: ['11.2'] },
  { label: '12.x', lines: ['12.1', '12.2'] },
  { label: '18 – 19', lines: ['18', '19'] },
  { label: '21', lines: ['21'] },
  { label: '23+', lines: ['23', '26'] },
];

export interface Filters {
  dbTypes: Set<string>;
  jars: Set<string>;
  ranges: Set<string>;
  oses: Set<string>;
  servers: Set<string>;
  envs: Set<string>;
  statuses: Set<Status>;
  query: string;
  /** Incluir conexões cujo driver não foi resolvido. */
  includeUnresolved: boolean;
}

export function emptyFilters(): Filters {
  return {
    dbTypes: new Set(['Oracle']),
    jars: new Set(),
    ranges: new Set(),
    oses: new Set(),
    servers: new Set(),
    envs: new Set(),
    statuses: new Set(),
    query: '',
    includeUnresolved: false,
  };
}

export function matches(fact: Fact, filters: Filters, catalog: Catalog): boolean {
  if (filters.dbTypes.size > 0 && !filters.dbTypes.has(fact.dbType)) return false;
  if (!filters.includeUnresolved && !fact.driverVersion) return false;
  if (filters.jars.size > 0 && !filters.jars.has(fact.jar ?? 'sem-jar')) return false;
  if (filters.ranges.size > 0) {
    const line = driverLine(fact.driverVersion);
    if (!line) return false;
    const hit = RANGES.some((range) => filters.ranges.has(range.label) && range.lines.includes(line));
    if (!hit) return false;
  }
  if (filters.oses.size > 0 && !filters.oses.has(fact.os)) return false;
  if (filters.servers.size > 0 && !filters.servers.has(fact.server)) return false;
  if (filters.envs.size > 0 && !filters.envs.has(fact.env)) return false;
  if (filters.statuses.size > 0 && !filters.statuses.has(statusOf(fact, catalog))) return false;
  if (filters.query) {
    const text = [fact.host, fact.dbHost, fact.dbName, fact.name, fact.driverVersion, fact.server, fact.serverVersion].join(' ').toLowerCase();
    if (!filters.query.split(/\s+/).every((word) => text.includes(word))) return false;
  }
  return true;
}

/** Contagens da matriz: conexões por linha (total) e por linha × banco (com catálogo). */
export function matrixCounts(facts: Fact[], catalog: Catalog): { total: Map<string, number>; cell: Map<string, number> } {
  const total = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const fact of facts) {
    const row = matrixRowOf(fact);
    if (!row) continue;
    total.set(row.id, (total.get(row.id) ?? 0) + 1);
    const db = catalog[shortHost(fact.dbHost) ?? ''];
    if (db) cell.set(`${row.id}|${db}`, (cell.get(`${row.id}|${db}`) ?? 0) + 1);
  }
  return { total, cell };
}

export interface MigrationTarget {
  rowId: string;
  /** Bancos em uso que esta linha atende com certificação (Yes). */
  covers: DbVersion[];
  /** Bancos em uso que ela não cobre; exigem atualizar o banco. */
  missing: DbVersion[];
}

/** Para uma linha selecionada, quais outras linhas são certificadas para os bancos que ela atende hoje. */
export function migrationTargets(selectedId: string, cell: Map<string, number>, hasCatalog: boolean): MigrationTarget[] {
  const selected = MATRIX_ROWS.find((row) => row.id === selectedId);
  if (!selected) return [];
  const inUse = DB_VERSIONS.filter((db) => (hasCatalog ? (cell.get(`${selectedId}|${db}`) ?? 0) > 0 : compatOf(selected.line, db) !== 'bad'));
  const need = inUse.length > 0 ? inUse : DB_VERSIONS.filter((db) => compatOf(selected.line, db) !== 'bad');
  const targets: MigrationTarget[] = [];
  for (const row of MATRIX_ROWS) {
    if (row.id === selectedId) continue;
    const covers = need.filter((db) => compatOf(row.line, db) === 'ok');
    if (covers.length > 0) targets.push({ rowId: row.id, covers, missing: need.filter((db) => !covers.includes(db)) });
  }
  return targets;
}

export { DRIVER_LINES };
