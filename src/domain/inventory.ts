import { normalizeDbVersion } from './analysis';
import { DEFAULT_ENV_RULE, envFromHostname } from '../rules/env';
import type { DbVersion, EnvRule, Fact, Snapshot, SnapshotStats } from './types';

/** Formato exportado pelo dashboard do Java Assessment (Administração → exportar inventário). */
export const SUPPORTED_FORMAT = 'java-assessment-inventory';
export const SUPPORTED_VERSIONS: readonly number[] = [2];

export class InventoryFormatError extends Error {}

// A exportação é JSON de terceiros: a fronteira é tratada como dado solto e validada abaixo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

export interface PreviewInfo {
  format: string;
  formatVersion: number;
  dashboardVersion: string;
  exportedAt: string;
  label: string;
  containsCredentials: boolean;
  counts: Record<string, number>;
}

/** Valida o cabeçalho sem montar os fatos; serve para a prévia antes de importar. */
export function previewInventory(json: unknown): PreviewInfo {
  const root = (json ?? {}) as Row;
  const meta = (root.metadata ?? {}) as Row;
  if (meta.format !== SUPPORTED_FORMAT) {
    throw new InventoryFormatError(`Arquivo não é uma exportação do Java Assessment (formato "${String(meta.format)}").`);
  }
  const version = Number(meta.formatVersion);
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new InventoryFormatError(
      `Versão de formato ${String(meta.formatVersion)} não suportada (suportadas: ${SUPPORTED_VERSIONS.join(', ')}).`,
    );
  }
  if (typeof root.data !== 'object' || root.data === null) throw new InventoryFormatError('A exportação não tem a seção "data".');
  return {
    format: meta.format,
    formatVersion: version,
    dashboardVersion: String(meta.dashboardVersion ?? ''),
    exportedAt: String(meta.exportedAt ?? ''),
    label: String(meta.label ?? ''),
    containsCredentials: meta.containsCredentials === true,
    counts: (meta.counts ?? {}) as Record<string, number>,
  };
}

function osName(host: Row | undefined): string {
  const text = String(host?.distribution ?? host?.osName ?? '');
  const release = /release\s+(\d+(?:\.\d+)?)/.exec(text);
  if (/red hat/i.test(text) && release) return `RHEL ${release[1]}`;
  if (release && text) return `${(text.split(' release')[0] ?? '').replace('Enterprise Linux', '').trim().slice(0, 20)} ${release[1]}`;
  return text.slice(0, 30) || 'Sistema não informado';
}

/** Versões do banco vindas do CMDB (campos databaseVersion* da exportação 2.1.28+); nada quando o arquivo não os traz. */
function dbVersionsOf(ds: Row): Pick<Fact, 'dbVersions' | 'dbVersionStatus'> {
  if (ds.databaseVersionStatus === undefined && ds.databaseVersions === undefined) return {};
  const list: unknown[] = Array.isArray(ds.databaseVersions) ? ds.databaseVersions : ds.databaseVersion ? [ds.databaseVersion] : [];
  const versions = [...new Set(list.map((v) => normalizeDbVersion(String(v))).filter((v): v is DbVersion => v !== null))];
  return { dbVersions: versions, dbVersionStatus: ds.databaseVersionStatus === undefined ? undefined : String(ds.databaseVersionStatus) };
}

function jarOf(artifact: string | undefined, family: string | undefined): string | null {
  const fromPath = /(ojdbc\d+)/i.exec(artifact ?? '') ?? /(ojdbc\d+)/i.exec(family ?? '');
  return fromPath ? (fromPath[1] ?? '').toLowerCase() : null;
}

export interface BuildOptions {
  envRule?: EnvRule;
  fileName?: string;
  importedAt?: string;
}

/** Normaliza a exportação em fatos (datasource × associação) e estatísticas de qualidade da coleta. */
export function buildSnapshot(json: unknown, options: BuildOptions = {}): Snapshot {
  const info = previewInventory(json);
  const data = ((json as Row).data ?? {}) as Row;
  const envRule = options.envRule ?? DEFAULT_ENV_RULE;

  const hosts = new Map<string, Row>(rows(data.hosts).map((h) => [String(h.id), h]));
  const environments = new Map<string, string>(rows(data.environments).map((e) => [String(e.id), String(e.name)]));
  const servers = new Map<string, Row>(rows(data.servers).map((s) => [String(s.id), s]));
  const applications = new Map<string, Row>(rows(data.applications).map((a) => [String(a.id), a]));
  const processes = new Map<string, Row>(rows(data.processes).map((p) => [`${String(p.hostId)}|${String(p.pid)}`, p]));

  const SPRING = /spring|application\.(properties|ya?ml)/i;

  function serverOf(hostId: string, assoc: Row, ds: Row): { server: string; version: string; jdk: string | null } {
    const server = servers.get(String(assoc.serverId ?? ds.serverId ?? ''));
    const pid = assoc.pid ?? ds.pid;
    const process = processes.get(`${hostId}|${String(pid)}`);
    const jdk: string | null = process?.javaVersion ?? null;
    if (server) return { server: String(server.type), version: String(server.version ?? 's/ versão'), jdk };
    const app = applications.get(String(assoc.applicationId ?? ds.applicationId ?? ''));
    if (app?.applicationType === 'Spring Boot' || process?.applicationType === 'Spring Boot') {
      return { server: 'Spring Boot', version: String(app?.frameworkVersion ?? 's/ versão'), jdk };
    }
    if (process?.serverType) return { server: String(process.serverType), version: 's/ versão', jdk };
    const evidence = `${String(ds.evidence ?? '')} ${String(ds.name ?? '')} ${String(ds.sourcePath ?? '')}`;
    if (SPRING.test(evidence)) return { server: 'Spring Boot', version: 's/ versão', jdk };
    return { server: 'Sem servidor', version: '—', jdk };
  }

  const facts: Fact[] = [];
  for (const ds of rows(data.datasources)) {
    const hostId = String(ds.hostId);
    const host = hosts.get(hostId);
    const registered = host ? (environments.get(String(host.environmentId)) ?? null) : null;
    const associations: Row[] = rows(ds.associations).length > 0 ? rows(ds.associations) : [{}];
    const seen = new Set<string>();
    for (const assoc of associations) {
      const result: Row = (assoc.driverResult as Row | undefined) ?? ds;
      const { server, version, jdk } = serverOf(hostId, assoc, ds);
      const driverVersion: string | null = result.driverVersion ?? null;
      const resolution: string = result.driverResolution ?? ds.driverResolution ?? 'SEM_RESOLUCAO';
      const key = [server, version, driverVersion, resolution, jdk].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        ds: String(ds.id),
        hostId,
        host: host?.hostname ?? null,
        env: envFromHostname(host?.hostname, envRule),
        envRegistered: registered,
        os: osName(host),
        server,
        serverVersion: version,
        jdk,
        dbType: ds.databaseType ?? 'Desconhecido',
        dbHost: ds.databaseHost ?? null,
        dbPort: typeof ds.databasePort === 'number' ? ds.databasePort : null,
        dbName: ds.databaseName ? String(ds.databaseName).toUpperCase() : null,
        name: ds.name ?? null,
        driverVersion,
        jar: jarOf(result.driverArtifact ?? ds.driverArtifact, result.driverFamily),
        resolution,
        resolutionReason: result.driverResolutionReason ?? ds.driverResolutionReason ?? null,
        ...dbVersionsOf(ds),
      });
    }
  }

  const importedAt = options.importedAt ?? new Date().toISOString();
  return {
    id: `${info.exportedAt || importedAt}`,
    importedAt,
    exportedAt: info.exportedAt,
    dashboardVersion: info.dashboardVersion,
    label: info.label,
    fileName: options.fileName ?? '',
    counts: info.counts,
    stats: statsOf(facts, hosts, environments, envRule),
    facts,
  };
}

/** Compara nomes sem acento e caixa ("Producao" = "Produção"). */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function statsOf(facts: Fact[], hosts: Map<string, Row>, environments: Map<string, string>, envRule: EnvRule): SnapshotStats {
  const envInferred: Record<string, number> = {};
  let envMismatch = 0;
  for (const host of hosts.values()) {
    const inferred = envFromHostname(host.hostname, envRule);
    envInferred[inferred] = (envInferred[inferred] ?? 0) + 1;
    const registered = environments.get(String(host.environmentId));
    if (inferred !== envRule.fallback && registered !== undefined && plain(registered) !== plain(inferred)) envMismatch++;
  }
  const oracle = facts.filter((f) => f.dbType === 'Oracle');
  const datasources = new Set(oracle.map((f) => f.ds));
  const withDriver = new Set(oracle.filter((f) => f.driverVersion).map((f) => f.ds));
  const unresolved: Record<string, number> = {};
  for (const id of datasources) {
    if (withDriver.has(id)) continue;
    const sample = oracle.find((f) => f.ds === id);
    const reason = sample ? (sample.resolution === 'SEM_RESOLUCAO' ? 'SEM_RESOLUCAO' : sample.resolution) : 'SEM_RESOLUCAO';
    unresolved[reason] = (unresolved[reason] ?? 0) + 1;
  }
  const dbStatus = new Map<string, string | undefined>();
  for (const f of oracle) if (!dbStatus.has(f.ds)) dbStatus.set(f.ds, f.dbVersionStatus);
  const hasCmdb = [...dbStatus.values()].some((s) => s !== undefined);
  const dbVersions = { single: 0, multiple: 0, unidentified: 0, noHost: 0 };
  for (const s of dbStatus.values()) {
    if (s === 'unica') dbVersions.single++;
    else if (s === 'multiplas') dbVersions.multiple++;
    else if (s === 'host_nao_informado') dbVersions.noHost++;
    else dbVersions.unidentified++;
  }
  return {
    facts: facts.length,
    hosts: hosts.size,
    oracleDatasources: datasources.size,
    oracleWithDriver: withDriver.size,
    envInferred,
    envMismatch,
    unresolved,
    ...(hasCmdb ? { dbVersions } : {}),
  };
}

/** Recalcula o ambiente dos fatos com outra regra, sem reimportar (o hostname fica no fato). */
export function withEnvRule(facts: Fact[], rule: EnvRule): Fact[] {
  return facts.map((fact) => ({ ...fact, env: envFromHostname(fact.host, rule) }));
}
