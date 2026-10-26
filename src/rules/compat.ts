import type { Compat, DbVersion, DriverLine } from '../domain/types';

/**
 * Matriz de certificação driver × banco, das tabelas de interoperabilidade dos
 * "JDBC Developer's Guide" da Oracle (19c, 21c e 26ai). Vale o valor da doc mais recente.
 * ok = "Yes" · legacy = "Was" (suportado, mas uma das versões saiu do suporte) · bad = sem certificação da Oracle (não listado ou "No";
 * o driver pode até conectar, mas a Oracle não o certifica nem dá suporte) · nv = não verificado.
 */
export const RULES_INFO = {
  readAt: '2026-10-26',
  sources: [
    'https://docs.oracle.com/en/database/oracle/oracle-database/19/jjdbc/JDBC-getting-started.html',
    'https://docs.oracle.com/en/database/oracle/oracle-database/21/jjdbc/JDBC-getting-started.html',
    'https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/JDBC-getting-started.html',
    'https://docs.oracle.com/en/middleware/standalone/weblogic-server/15.1.1/jdbca/Using_OracleDatabase.html',
  ],
  /** Fonte e limite das regras do WebLogic (JDK e banco por versão do servidor), que não vêm da matriz driver × banco. */
  weblogicSource: 'My Oracle Support, aba Certifications (exportação em CSV, 10.3.6 a 15.1.1), em src/rules/weblogic.json.',
  weblogicLimit: 'Vale para o JDK e o banco Oracle de cada versão. O MOS não certifica o jar ojdbc por versão do WebLogic; a verificação do driver é pelo JDK que ele exige e pelo banco. Versões fora dessa lista ficam sem aviso.',
  note: 'O guia do 23ai agora redireciona para o do 26ai (23ai e 26ai são a mesma linha de produto, 26ai = 23.26+). As células em INFERRED não constam literalmente nas docs lidas.',
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
  '23': ['bad', 'bad', 'bad', 'ok', 'ok', 'ok', 'ok'],
  '26': ['bad', 'bad', 'bad', 'ok', 'ok', 'ok', 'ok'],
};

/** Cruzamentos que as docs lidas não trazem literalmente (leitura própria). Chave: `${linha}|${banco}`. */
export const INFERRED: ReadonlySet<string> = new Set([
  '11.2|11g', '11.2|12c', '11.2|18c', '11.2|19c',
  '12.1|11g', '12.2|11g', '18|11g', '19|11g',
  '19|23ai', '21|23ai', '23|19c', '23|21c', '23|23ai', '23|26ai', '26|23ai',
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
  { id: 'ojdbc8|19', jar: 'ojdbc8', line: '19', release: '19.x', jdk: 'JDK 8, 11, 17, 19 e 21' },
  { id: 'ojdbc10|19', jar: 'ojdbc10', line: '19', release: '19.x', jdk: 'JDK 11, 17, 19 e 21' },
  { id: 'ojdbc8|21', jar: 'ojdbc8', line: '21', release: '21.x', jdk: 'JDK 8 e 11' },
  { id: 'ojdbc11|21', jar: 'ojdbc11', line: '21', release: '21.x', jdk: 'JDK 11, 17 e 19' },
  { id: 'ojdbc8|23', jar: 'ojdbc8', line: '23', release: '23ai', jdk: 'JDK 8 e 11' },
  { id: 'ojdbc11|23', jar: 'ojdbc11', line: '23', release: '23ai', jdk: 'JDK 11' },
  { id: 'ojdbc17|23', jar: 'ojdbc17', line: '23', release: '23.6+', jdk: 'JDK 17 a 21' },
  { id: 'ojdbc8|26', jar: 'ojdbc8', line: '26', release: '26ai (23.26+)', jdk: 'JDK 8 e 11' },
  { id: 'ojdbc11|26', jar: 'ojdbc11', line: '26', release: '26ai (23.26+)', jdk: 'JDK 11' },
  { id: 'ojdbc17|26', jar: 'ojdbc17', line: '26', release: '26ai (23.26+)', jdk: 'JDK 17 a 21' },
];

/**
 * Avisos do WebLogic Server (docs 15.1.1 e blog da Oracle). A matriz completa do WebLogic fica no
 * Oracle Certification Matrix / My Oracle Support (exige login), então aqui só entra o que é público.
 */
export const WEBLOGIC_NOTES: readonly string[] = [
  'WebLogic 14.1.1 vem com o driver 19.3; 14.1.2 e 15.1.1 vêm com o 23ai.',
  'WebLogic 14.1.2 em diante não suporta mais Oracle Database 12c.',
  'WebLogic 14.1.1, 14.1.2 e 15.1.1 são certificados com o Oracle AI Database 26ai.',
];

/** O ojdbc8 não implementa o JDBC 4.3 (nota do guia 26ai). */
export const JAR_NOTES: Record<string, string> = { ojdbc8: 'só JDBC 4.2' };

/** Nível da especificação JDBC que cada jar implementa (JDBC 4.2 é o do Java 8, 4.3 do Java 9 em diante). */
export const JAR_JDBC: Record<string, string> = {
  ojdbc6: '4.0',
  ojdbc7: '4.1',
  ojdbc8: '4.2',
  ojdbc10: '4.3',
  ojdbc11: '4.3',
  ojdbc17: '4.3',
};
