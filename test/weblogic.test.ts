import { describe, expect, it } from 'vitest';
import matrix from '../src/rules/weblogic.json';

const server = (version: string) => matrix.servers.find((s) => s.version === version);

describe('weblogic.json (gerado de matriz/arquivos)', () => {
  it('tem as 12 versões, sem repetir', () => {
    const versions = matrix.servers.map((s) => s.version);
    expect(versions).toHaveLength(12);
    expect(new Set(versions).size).toBe(12);
  });
  it('só traz Oracle Database, JDK e driver Thin, sem outros bancos', () => {
    for (const s of matrix.servers) expect(Object.keys(s).sort()).toEqual(['database', 'driver', 'jdk', 'source', 'version']);
    expect(JSON.stringify(matrix)).not.toMatch(/DB2|SQL Server|Sybase|MySQL|Derby/);
  });
  it('registra uso e tipo de cada banco', () => {
    for (const s of matrix.servers) for (const db of s.database) {
      expect(['servidor', 'aplicacao', 'rcu', 'geral']).toContain(db.usage);
      expect(['primary', 'secondary']).toContain(db.type);
    }
  });
  it('15.1.1 tem JDK 17 e 21; 10.3.6 só 1.7', () => {
    const jdks = (v: string) => (server(v)?.jdk ?? []).map((j) => j.version);
    expect(jdks('15.1.1').some((j) => j.startsWith('17.'))).toBe(true);
    expect(jdks('15.1.1').some((j) => j.startsWith('21.'))).toBe(true);
    expect(jdks('10.3.6').every((j) => j.startsWith('1.7.'))).toBe(true);
  });
  it('banco 23.26 vem marcado como Oracle AI Database', () => {
    expect(server('15.1.1')?.database.some((db) => db.ai && db.version.startsWith('23.26'))).toBe(true);
  });
});
