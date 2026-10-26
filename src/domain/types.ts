/** Linha de driver da Oracle (release do JDBC) e coluna de versão de banco. */
export type DriverLine = '11.2' | '12.1' | '12.2' | '18' | '19' | '21' | '23' | '26';
export type DbVersion = '11g' | '12c' | '18c' | '19c' | '21c' | '23ai' | '26ai';

/** ok = certificado (Yes) · legacy = suportado, uma versão fora de suporte (Was) · bad = a Oracle não lista · nv = não verificado. */
export type Compat = 'ok' | 'legacy' | 'bad' | 'nv';
/** Situação de uma conexão: compatibilidade, ou unk quando falta driver ou versão do banco. */
export type Status = Compat | 'unk';

export interface Fact {
  /** Id do datasource no inventário. */
  ds: string;
  hostId: string;
  host: string | null;
  /** Ambiente inferido pelo hostname (a regra mora em Settings). */
  env: string;
  /** Ambiente como o cliente cadastrou, só para apontar divergências. */
  envRegistered: string | null;
  os: string;
  /** Tipo do servidor de aplicação (WebLogic, Tomcat, JBoss, Spring Boot) ou 'Sem servidor'. */
  server: string;
  serverVersion: string;
  /** Versão do JDK em execução, como coletada (ex. 1.8.0_251). */
  jdk: string | null;
  dbType: string;
  dbHost: string | null;
  dbPort: number | null;
  dbName: string | null;
  /** Nome do datasource. */
  name: string | null;
  driverVersion: string | null;
  /** ojdbc6, ojdbc8, ojdbc11... a partir do caminho do artefato. */
  jar: string | null;
  /** Estado de resolução do coletor (IDENTIFIED, INCOMPLETE...) ou SEM_RESOLUCAO. */
  resolution: string;
  resolutionReason: string | null;
}

export interface SnapshotMeta {
  id: string;
  importedAt: string;
  exportedAt: string;
  dashboardVersion: string;
  label: string;
  fileName: string;
  counts: Record<string, number>;
  /** Fatos por tipo de banco, e cobertura de driver do Oracle. */
  stats: SnapshotStats;
}

export interface SnapshotStats {
  facts: number;
  hosts: number;
  oracleDatasources: number;
  oracleWithDriver: number;
  /** Máquinas por ambiente inferido pelo hostname. */
  envInferred: Record<string, number>;
  /** Máquinas cujo ambiente cadastrado difere do inferido. */
  envMismatch: number;
  /** Datasources Oracle sem versão de driver, por motivo. */
  unresolved: Record<string, number>;
}

export interface Snapshot extends SnapshotMeta {
  facts: Fact[];
}

/** Regra de ambiente pelo hostname: a letra na posição dada indica o ambiente. */
export interface EnvRule {
  /** Posição (1 = primeira) do caractere que identifica o ambiente. */
  position: number;
  letters: Record<string, string>;
  /** Rótulo quando o hostname não segue o padrão. */
  fallback: string;
}

export interface Settings {
  envRule: EnvRule;
  /** Quantos snapshots guardar ao importar. */
  keepSnapshots: number;
}

/** Catálogo: host do banco (nome curto ou IP) → versão. */
export type Catalog = Record<string, DbVersion>;
