import { DB_VERSIONS, DRIVER_LINES, MATRIX_ROWS, compatOf, type MatrixRow } from '../rules/compat';
import { certifiedDbs, weblogicRule } from '../rules/weblogic';
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
  if (major > 23 && major <= 29) return '26';
  return null;
}

/** Linha do driver da conexão; só o driver Oracle entra (PostgreSQL 42.x, MySQL 8.x etc. não têm linha na matriz). */
export function factLine(fact: Pick<Fact, 'dbType' | 'driverVersion'>): DriverLine | null {
  return fact.dbType === 'Oracle' ? driverLine(fact.driverVersion) : null;
}

/** Versão principal do JDK (1.8.0_251 → 8, 17.0.7 → 17). */
export function jdkMajor(version: string | null | undefined): number | null {
  if (!version) return null;
  const match = /^1\.(\d+)/.exec(version) ?? /^(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

const isWls12214 = (fact: Pick<Fact, 'server' | 'serverVersion'>): boolean => fact.server === 'WebLogic' && fact.serverVersion.startsWith('12.2.1.4');

/** Números de um JDK para comparar (1.8.0_251 → [8, 0, 251], 17.0.7 → [17, 0, 7]). */
function jdkParts(version: string): number[] {
  const numbers = version.split(/[._]/).map((part) => parseInt(part, 10)).filter((n) => !Number.isNaN(n));
  return numbers[0] === 1 ? numbers.slice(1) : numbers;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Problemas do servidor com o JDK e com o banco, segundo a certificação do My Oracle Support (src/rules/weblogic.json), ou null. */
export function serverIssue(fact: Pick<Fact, 'server' | 'serverVersion' | 'jdk' | 'dbHost' | 'dbVersions'>, catalog: Catalog = {}): string | null {
  if (fact.server !== 'WebLogic') return null;
  const rule = weblogicRule(fact.serverVersion);
  if (!rule) return null;
  const issues: string[] = [];
  const major = jdkMajor(fact.jdk);
  if (major !== null && fact.jdk && rule.jdk.length > 0) {
    const sameMajor = rule.jdk.filter((entry) => jdkParts(entry.version)[0] === major);
    if (sameMajor.length === 0) {
      const majors = [...new Set(rule.jdk.map((entry) => jdkParts(entry.version)[0]))].sort((x, y) => (x ?? 0) - (y ?? 0));
      issues.push(`WebLogic ${rule.version} é certificado só com JDK ${majors.join(', ')}; este roda JDK ${major}.`);
    } else {
      const lowest = sameMajor.reduce((min, entry) => (compareParts(jdkParts(entry.version), jdkParts(min.version)) < 0 ? entry : min));
      const parts = jdkParts(fact.jdk);
      if (parts.length > 2 && compareParts(parts, jdkParts(lowest.version)) < 0) issues.push(`WebLogic ${rule.version} exige JDK ${major} a partir da ${lowest.version}; este roda ${fact.jdk}.`);
    }
  }
  const dbs = certifiedDbs(rule, normalizeDbVersion);
  const outside = dbs.size > 0 ? dbVersionsOf(fact, catalog).filter((v) => !dbs.has(v)) : [];
  if (outside.length > 0) issues.push(`O My Oracle Support não lista o banco ${outside.join('/')} para o WebLogic ${rule.version} (lista ${DB_VERSIONS.filter((v) => dbs.has(v)).join(', ')}).`);
  return issues.length > 0 ? issues.join(' ') : null;
}

/** Aviso quando o WebLogic 12.2.1.4 usa um driver diferente do que vem de fábrica (ojdbc8 19.3); null quando é o de fábrica ou não se aplica. */
export function embeddedDriverNote(fact: Pick<Fact, 'server' | 'serverVersion' | 'dbType' | 'driverVersion' | 'jar'>): string | null {
  if (!isWls12214(fact) || fact.dbType !== 'Oracle' || !fact.driverVersion) return null;
  return fact.jar === 'ojdbc8' && /^19\.3(\.|$)/.test(fact.driverVersion) ? null : 'Não é o driver de fábrica do WebLogic 12.2.1.4 (ojdbc8 19.3): o jar foi trocado ou vem na aplicação.';
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

const WORST: readonly Status[] = ['bad', 'legacy', 'ok', 'nv', 'unk'];

/** Versões do banco de uma conexão: o catálogo manual vale sozinho; sem ele, as do CMDB (podem ser várias). */
export function dbVersionsOf(fact: Pick<Fact, 'dbHost' | 'dbVersions'>, catalog: Catalog): DbVersion[] {
  const manual = catalog[shortHost(fact.dbHost) ?? ''];
  return manual ? [manual] : (fact.dbVersions ?? []);
}

/** Rótulo curto das versões ("19c" ou "18c/19c"), ou null sem versão. */
export function dbVersionLabel(versions: readonly DbVersion[]): string | null {
  return versions.length > 0 ? versions.join('/') : null;
}

/** Alguma conexão do conjunto tem versão de banco (catálogo ou CMDB)? */
export function hasDbVersions(facts: readonly Fact[], catalog: Catalog): boolean {
  return Object.keys(catalog).length > 0 || facts.some((fact) => (fact.dbVersions?.length ?? 0) > 0);
}

/** Bancos distintos (host curto) com versão conhecida, por catálogo ou CMDB. */
export function hostsWithVersion(facts: readonly Fact[], catalog: Catalog): Set<string> {
  const hosts = new Set<string>();
  for (const fact of facts) {
    const host = shortHost(fact.dbHost);
    if (host && dbVersionsOf(fact, catalog).length > 0) hosts.add(host);
  }
  return hosts;
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
  const line = factLine(fact);
  if (!line) return 'unk';
  return worstOf(dbVersionsOf(fact, catalog).map((db) => compatOf(line, db)));
}

/** Pior situação da lista (bad > legacy > ok > nv); 'unk' quando vazia. */
function worstOf(statuses: Status[]): Status {
  return WORST.find((status) => statuses.includes(status)) ?? 'unk';
}

/** A versão do banco que decide a situação: a de pior compatibilidade (a mais nova no empate). */
function decisiveDb(fact: Fact, line: DriverLine, catalog: Catalog): DbVersion | undefined {
  const versions = dbVersionsOf(fact, catalog);
  return [...versions].sort((a, b) => WORST.indexOf(compatOf(line, a)) - WORST.indexOf(compatOf(line, b)) || DB_VERSIONS.indexOf(b) - DB_VERSIONS.indexOf(a))[0];
}

/** Linha da matriz (jar + release) onde a conexão está hoje. */
export function matrixRowOf(fact: Fact): MatrixRow | null {
  const line = factLine(fact);
  if (!line) return null;
  const exact = MATRIX_ROWS.find((row) => row.id === `${fact.jar ?? ''}|${line}`);
  return exact ?? MATRIX_ROWS.find((row) => row.line === line) ?? null;
}

/** Sugestão de migração textual para uma conexão, ou null quando não há o que sugerir. */
export function suggest(fact: Fact, catalog: Catalog): string | null {
  const parts = [serverIssue(fact, catalog), driverAdvice(fact, catalog)].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** JDK 6 ou 7: o ojdbc8 (exige JDK 8+) não roda, então o teto do driver é o 12.1, certificado só até o 19c. */
function oldJdkAdvice(jdk: number, db: DbVersion | undefined): string {
  const best = jdk === 6 ? 'ojdbc6 12.1' : 'ojdbc7 12.1';
  const head = `JDK ${jdk}: o ojdbc8 exige JDK 8 ou mais novo e não roda neste servidor. O driver mais novo possível é o ${best}, que a Oracle certifica só até o 19c (fora de suporte).`;
  const high = db === '21c' || db === '23ai' || db === '26ai';
  if (high) return `${head} Para o banco ${db} é preciso subir o JDK para 8 ou mais, o que costuma exigir atualizar o servidor de aplicação. Sem isso, não há driver certificado.`;
  return `${head} Para ir ao ojdbc8 19.x, suba antes o JDK para 8 ou mais (o que costuma exigir atualizar o servidor de aplicação). Confirmar a versão do servidor com a Oracle.`;
}

/** Jars de driver antigos: o nome já diz que a migração é necessária, mesmo sem a versão resolvida. */
const OLD_JARS: ReadonlySet<string> = new Set(['ojdbc14', 'ojdbc5', 'ojdbc6', 'ojdbc7']);

/** Sugestão pelo nome do jar quando a versão do driver não foi resolvida; só para jars antigos. */
function jarAdvice(fact: Fact): string | null {
  if (fact.dbType !== 'Oracle' || !fact.jar || !OLD_JARS.has(fact.jar)) return null;
  const jdk = jdkMajor(fact.jdk);
  const head = `Versão do driver não resolvida, mas o jar ${fact.jar} é de um driver antigo.`;
  if (jdk !== null && jdk < 8) return `${head} ${oldJdkAdvice(jdk, undefined)}`;
  return `${head} Migrar para ojdbc8 19.x (roda em JDK 8, 11, 17, 19 e 21 e é certificado com 19c, 21c e 26ai). Informe a versão do banco para confirmar.`;
}

function driverAdvice(fact: Fact, catalog: Catalog): string | null {
  const line = factLine(fact);
  if (!line) return jarAdvice(fact);
  const db = decisiveDb(fact, line, catalog);
  const all = dbVersionsOf(fact, catalog);
  const jdk = jdkMajor(fact.jdk);
  if (jdk !== null && jdk < 8) return oldJdkAdvice(jdk, db);
  const jar = jdk === null || jdk <= 8 ? 'ojdbc8' : jdk <= 11 ? 'ojdbc11' : 'ojdbc17';
  const old = line === '11.2' || line === '12.1' || line === '12.2' || line === '18';
  if (!db) {
    return old ? 'Migrar para ojdbc8 19.x (roda em JDK 8, 11, 17, 19 e 21 e é certificado com 19c, 21c e 26ai). Informe a versão do banco para confirmar.' : null;
  }
  const status = statusOf(fact, catalog);
  if (status === 'ok') return null;
  const mixed = all.length > 1 ? ` O CMDB lista mais de uma versão para este banco (${all.join('/')}); avaliado o pior caso, confirme qual o datasource usa.` : '';
  if (status === 'nv') return `Combinação não verificada nas docs da Oracle (driver ${line} com banco ${db}). Conferir antes de decidir.${mixed}`;
  const high = db === '21c' || db === '23ai' || db === '26ai';
  const target = high ? `${jar} 26ai/23.26+ (certificado com 19c, 21c e 26ai)` : 'ojdbc8 19.x (certificado com 19c, 21c e 26ai)';
  if (status === 'bad') return `Sem certificação: a Oracle não certifica este driver com o banco ${db} (pode conectar, mas sem suporte). Usar ${target}.${mixed}`;
  return `Combinação em “Was” (uma versão fora do suporte). Alinhar para ${target}${/^(11|12|18)/.test(db) ? ' e planejar a atualização do banco' : ''}.${mixed}`;
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
    const line = factLine(fact);
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
    for (const db of dbVersionsOf(fact, catalog)) cell.set(`${row.id}|${db}`, (cell.get(`${row.id}|${db}`) ?? 0) + 1);
  }
  return { total, cell };
}

export interface MigrationTarget {
  rowId: string;
  /** Bancos em uso que esta linha atende com certificação (Yes). */
  covers: DbVersion[];
  /** Bancos em uso que ela não cobre; exigem atualizar o banco. */
  missing: DbVersion[];
  /** Conexões da linha de origem que migram sem trocar JDK nem servidor, e o total considerado (0 sem fatos). */
  ok: number;
  total: number;
  /** O que impede a migração de parte das conexões: JDK do servidor ou banco que o servidor não certifica. */
  blockers: string[];
  /** Serve de destino: há conexões que migram (ou, sem fatos da origem, bancos cobertos). */
  usable: boolean;
}

/** Versões de JDK que o jar suporta, lidas do texto da matriz ("JDK 6 a 8", "JDK 8, 11, 17, 19 e 21"). */
function jdkSupport(text: string): Set<number> {
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (nums.length === 2 && first !== undefined && last !== undefined && / a /.test(text)) {
    return new Set(Array.from({ length: last - first + 1 }, (_, i) => first + i));
  }
  return new Set(nums);
}

/**
 * Para uma linha selecionada, quais outras linhas servem de destino. Leva em conta o banco (certificação do driver),
 * o JDK em que o servidor roda (o jar precisa suportá-lo) e, no WebLogic, os bancos que o My Oracle Support certifica para a versão.
 */
export function migrationTargets(selectedId: string, cell: Map<string, number>, hasCatalog: boolean, rowFacts: Fact[] = [], catalog: Catalog = {}): MigrationTarget[] {
  const selected = MATRIX_ROWS.find((row) => row.id === selectedId);
  if (!selected) return [];
  const inUse = DB_VERSIONS.filter((db) => (hasCatalog ? (cell.get(`${selectedId}|${db}`) ?? 0) > 0 : compatOf(selected.line, db) !== 'bad'));
  const need = inUse.length > 0 ? inUse : DB_VERSIONS.filter((db) => compatOf(selected.line, db) !== 'bad');
  const targets: MigrationTarget[] = [];
  for (const row of MATRIX_ROWS) {
    if (row.id === selectedId) continue;
    const covers = need.filter((db) => compatOf(row.line, db) === 'ok');
    const supported = jdkSupport(row.jdk);
    const blockers = new Set<string>();
    let ok = 0;
    for (const fact of rowFacts) {
      const jdk = jdkMajor(fact.jdk);
      const label = fact.server === 'Sem servidor' ? fact.server : `${fact.server} ${fact.serverVersion}`;
      if (jdk !== null && !supported.has(jdk)) { blockers.add(`${label} roda JDK ${jdk}; o ${row.jar} suporta ${row.jdk.replace('JDK ', 'JDK ')}`); continue; }
      const dbs = (hasCatalog ? dbVersionsOf(fact, catalog) : []).length > 0 ? dbVersionsOf(fact, catalog) : need;
      const rule = fact.server === 'WebLogic' ? weblogicRule(fact.serverVersion) : null;
      const certified = rule ? certifiedDbs(rule, normalizeDbVersion) : null;
      const noServer = certified && certified.size > 0 ? dbs.filter((db) => !certified.has(db)) : [];
      if (noServer.length > 0) { blockers.add(`${label} não certifica o banco ${noServer.join('/')} (My Oracle Support)`); continue; }
      if (dbs.every((db) => compatOf(row.line, db) === 'ok')) ok++;
    }
    const usable = rowFacts.length > 0 ? ok > 0 : covers.length > 0;
    targets.push({ rowId: row.id, covers, missing: need.filter((db) => !covers.includes(db)), ok, total: rowFacts.length, blockers: [...blockers], usable });
  }
  return targets;
}

export { DRIVER_LINES };
