import type { Compat, DbVersion, DriverLine } from '../domain/types';

/**
 * Matriz de certificação driver × banco, das tabelas de interoperabilidade dos
 * "JDBC Developer's Guide" da Oracle (19c, 21c e 26ai). Vale o valor da doc mais recente.
 * ok = "Yes" · legacy = "Was" (suportado, mas uma das versões saiu do suporte) · bad = a Oracle não lista · nv = não verificado.
 */
export const RULES_INFO = {
  readAt: '2026-10-26',
  sources: [
    'https://docs.oracle.com/en/database/oracle/oracle-database/19/jjdbc/JDBC-getting-started.html',
    'https://docs.oracle.com/en/database/oracle/oracle-database/21/jjdbc/JDBC-getting-started.html',
    'https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/JDBC-getting-started.html',
  ],
  note: 'A doc do 23ai só foi lida por resumo de busca; as células marcadas em INFERRED não constam literalmente nas docs lidas.',
} as const;

export const DB_VERSIONS: readonly DbVersion[] = ['11g', '12c', '18c', '19c', '21c', '23ai', '26ai'];
export const DRIVER_LINES: readonly DriverLine[] = ['11.2', '12.1', '12.2', '18', '19', '21', '23', '26'];

export const MATRIX: Record<DriverLine, readonly Compat[]> = {
  '11.2': ['legacy', 'legacy', 'legacy', 'legacy', 'bad', 'bad', 'bad'],
  '12.1': ['legacy', 'legacy', 'legacy', 'legacy', 'legacy', 'bad', 'bad'],
  '12.2': ['legacy', 'legacy', 'legacy', 'legacy', 'legacy', 'bad', 'bad'],
  '18': ['legacy', 'legacy', 'legacy', 'legacy', 'legacy', 'bad', 'bad'],
  '19': ['legacy', 'legacy', 'legacy', 'ok', 'ok', 'ok', 'ok'],
  '21': ['bad', 'legacy', 'legacy', 'ok', 'ok', 'ok', 'ok'],
  '23': ['bad', 'bad', 'bad', 'ok', 'ok', 'ok', 'nv'],
  '26': ['bad', 'bad', 'bad', 'ok', 'ok', 'nv', 'ok'],
};

/** Cruzamentos que as docs lidas não trazem literalmente (leitura própria). Chave: `${linha}|${banco}`. */
export const INFERRED: ReadonlySet<string> = new Set([
  '11.2|11g', '11.2|12c', '11.2|18c', '11.2|19c',
  '12.1|11g', '12.2|11g', '18|11g', '19|11g',
  '19|23ai', '21|23ai', '23|19c', '23|21c', '23|23ai',
]);

export function compatOf(line: DriverLine, db: DbVersion): Compat {
  const index = DB_VERSIONS.indexOf(db);
  return MATRIX[line][index] ?? 'bad';
}

/** Uma linha da matriz: um jar numa release do driver. */
export interface MatrixRow {
  id: string;
  jar: string;
  line: DriverLine;
  release: string;
  jdk: string;
}

export const MATRIX_ROWS: readonly MatrixRow[] = [
  { id: 'ojdbc6|11.2', jar: 'ojdbc6', line: '11.2', release: '11.2', jdk: 'JDK 6 a 8' },
  { id: 'ojdbc6|12.1', jar: 'ojdbc6', line: '12.1', release: '12.1', jdk: 'JDK 6' },
  { id: 'ojdbc7|12.1', jar: 'ojdbc7', line: '12.1', release: '12.1', jdk: 'JDK 7 e 8' },
  { id: 'ojdbc8|12.2', jar: 'ojdbc8', line: '12.2', release: '12.2', jdk: 'JDK 8' },
  { id: 'ojdbc8|18', jar: 'ojdbc8', line: '18', release: '18.3', jdk: 'JDK 8 a 11' },
  { id: 'ojdbc8|19', jar: 'ojdbc8', line: '19', release: '19.x', jdk: 'JDK 8 a 21' },
  { id: 'ojdbc10|19', jar: 'ojdbc10', line: '19', release: '19.x', jdk: 'JDK 11 a 21' },
  { id: 'ojdbc8|21', jar: 'ojdbc8', line: '21', release: '21.x', jdk: 'JDK 8 e 11' },
  { id: 'ojdbc11|21', jar: 'ojdbc11', line: '21', release: '21.x', jdk: 'JDK 11 a 19' },
  { id: 'ojdbc8|23', jar: 'ojdbc8', line: '23', release: '23ai', jdk: 'JDK 8 e 11' },
  { id: 'ojdbc11|23', jar: 'ojdbc11', line: '23', release: '23ai', jdk: 'JDK 11' },
  { id: 'ojdbc8|26', jar: 'ojdbc8', line: '26', release: '26ai (23.26+)', jdk: 'JDK 8 e 11' },
  { id: 'ojdbc11|26', jar: 'ojdbc11', line: '26', release: '26ai (23.26+)', jdk: 'JDK 11' },
  { id: 'ojdbc17|26', jar: 'ojdbc17', line: '26', release: '26ai (23.26+)', jdk: 'JDK 17 a 21' },
];

/** O ojdbc8 não implementa o JDBC 4.3 (nota do guia 26ai). */
export const JAR_NOTES: Record<string, string> = { ojdbc8: 'só JDBC 4.2' };
