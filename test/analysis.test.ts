import { describe, expect, it } from 'vitest';
import { driverLine, jdkMajor, matches, emptyFilters, matrixCounts, matrixRowOf, migrationTargets, normalizeDbVersion, parseCatalog, shortHost, statusOf, suggest } from '../src/domain/analysis';
import { buildSnapshot } from '../src/domain/inventory';
import type { Catalog, Fact } from '../src/domain/types';
import { MATRIX, MATRIX_ROWS, compatOf } from '../src/rules/compat';
import { syntheticExport } from './fixtures';

function fact(patch: Partial<Fact>): Fact {
  return {
    ds: 'd', hostId: 'h', host: 'h', env: 'Desenvolvimento', envRegistered: null, os: 'RHEL 8.9', server: 'WebLogic', serverVersion: '12.2.1.4.0', jdk: '1.8.0_251',
    dbType: 'Oracle', dbHost: 'dbscan1.example.net', dbPort: 1521, dbName: 'X', name: 'ds', driverVersion: '19.3.0.0.0', jar: 'ojdbc8', resolution: 'IDENTIFIED', resolutionReason: null, ...patch,
  };
}

describe('driverLine', () => {
  it.each([
    ['11.2.0.4.0', '11.2'], ['12.1.0.2.0', '12.1'], ['12.2.0.1.0', '12.2'], ['18.3.0.0.0', '18'], ['19.3.0.0.0', '19'],
    ['21.9.0.0.0', '21'], ['23.7.0.25.01', '23'], ['23.26.3.0.0', '26'],
  ])('%s → %s', (version, line) => expect(driverLine(version)).toBe(line));
  it('ignora versões que não são do driver Oracle', () => {
    expect(driverLine('1.3.173.redhat-2')).toBeNull();
    expect(driverLine('2.3.232')).toBeNull();
    expect(driverLine(null)).toBeNull();
  });
});

describe('normalizações', () => {
  it('jdkMajor', () => {
    expect(jdkMajor('1.8.0_251')).toBe(8);
    expect(jdkMajor('17.0.7')).toBe(17);
    expect(jdkMajor(null)).toBeNull();
  });
  it('normalizeDbVersion', () => {
    expect(normalizeDbVersion('19c')).toBe('19c');
    expect(normalizeDbVersion('Oracle 12.2')).toBe('12c');
    expect(normalizeDbVersion('11.2.0.4')).toBe('11g');
    expect(normalizeDbVersion('23ai')).toBe('23ai');
    expect(normalizeDbVersion('26')).toBe('26ai');
    expect(normalizeDbVersion('nada')).toBeNull();
  });
  it('shortHost mantém IP inteiro', () => {
    expect(shortHost('dbscan1.example.net')).toBe('dbscan1');
    expect(shortHost('10.1.2.3')).toBe('10.1.2.3');
    expect(shortHost(null)).toBeNull();
  });
});

describe('parseCatalog', () => {
  it('lê host;versão e rejeita linhas inválidas', () => {
    const { catalog, rejected } = parseCatalog('dbscan1.example.net;19c\n# comentário\n10.1.2.3,12.2\n\nsem-versao;x\nsó-uma-coluna');
    expect(catalog).toEqual({ dbscan1: '19c', '10.1.2.3': '12c' });
    expect(rejected.map((r) => r.line)).toEqual([5, 6]);
  });
});

describe('matriz de compatibilidade', () => {
  it('só marca ok o que a Oracle certifica (19, 21 e 26ai com 19c, 21c e 26ai)', () => {
    for (const line of ['19', '21'] as const) for (const db of ['19c', '21c', '26ai'] as const) expect(compatOf(line, db)).toBe('ok');
    expect(compatOf('26', '19c')).toBe('ok');
    expect(compatOf('11.2', '19c')).toBe('legacy');
    expect(compatOf('11.2', '21c')).toBe('bad');
    expect(compatOf('23', '26ai')).toBe('ok');
    expect(compatOf('26', '23ai')).toBe('ok');
    expect(compatOf('21', '11g')).toBe('bad');
  });
  it('cada linha da matriz tem uma entrada por versão de banco', () => {
    for (const cells of Object.values(MATRIX)) expect(cells).toHaveLength(7);
    for (const row of MATRIX_ROWS) expect(MATRIX[row.line]).toBeDefined();
  });
});

describe('statusOf e matrixRowOf', () => {
  const catalog: Catalog = { dbscan1: '19c', dbscan2: '12c' };
  it('combina driver e banco', () => {
    expect(statusOf(fact({}), catalog)).toBe('ok');
    expect(statusOf(fact({ dbHost: 'dbscan2.example.net' }), catalog)).toBe('legacy');
    expect(statusOf(fact({ driverVersion: '11.2.0.4.0', jar: 'ojdbc6', dbHost: 'dbscan3' }), { dbscan3: '21c' })).toBe('bad');
  });
  it('é unk sem driver ou sem versão do banco', () => {
    expect(statusOf(fact({ driverVersion: null }), catalog)).toBe('unk');
    expect(statusOf(fact({ dbHost: 'outro.example.net' }), catalog)).toBe('unk');
  });
  it('escolhe a linha pelo jar quando existe', () => {
    expect(matrixRowOf(fact({ driverVersion: '21.5.0.0.0', jar: 'ojdbc11' }))?.id).toBe('ojdbc11|21');
    expect(matrixRowOf(fact({ driverVersion: '21.5.0.0.0', jar: 'ojdbc8' }))?.id).toBe('ojdbc8|21');
    expect(matrixRowOf(fact({ driverVersion: '21.5.0.0.0', jar: null }))?.id).toBe('ojdbc8|21');
  });
});

describe('suggest', () => {
  it('sem catálogo, sugere sair dos drivers antigos', () => {
    expect(suggest(fact({ driverVersion: '11.2.0.4.0', jar: 'ojdbc6' }), {})).toMatch(/ojdbc8 19\.x/);
    expect(suggest(fact({}), {})).toBeNull();
  });
  it('escolhe o jar pelo JDK quando o banco exige driver novo', () => {
    const text = suggest(fact({ driverVersion: '11.2.0.4.0', jar: 'ojdbc6', jdk: '17.0.7' }), { dbscan1: '21c' });
    expect(text).toMatch(/ojdbc17/);
    expect(text).toMatch(/Sem certificação/);
  });
  it('não sugere quando já está certificado', () => {
    expect(suggest(fact({}), { dbscan1: '19c' })).toBeNull();
  });
});

describe('filtros e agregações', () => {
  const snapshot = buildSnapshot(syntheticExport());
  const facts = snapshot.facts;
  it('o filtro padrão mostra só Oracle com driver', () => {
    expect(facts.filter((f) => matches(f, emptyFilters(), {}))).toHaveLength(2);
  });
  it('incluir não resolvidos devolve o terceiro datasource Oracle', () => {
    const filters = { ...emptyFilters(), includeUnresolved: true };
    expect(facts.filter((f) => matches(f, filters, {}))).toHaveLength(3);
  });
  it('faixa de driver filtra por linha', () => {
    const filters = { ...emptyFilters(), ranges: new Set(['≤ 11.2']) };
    expect(facts.filter((f) => matches(f, filters, {})).map((f) => f.ds)).toEqual(['d1']);
  });
  it('conta conexões por linha e por banco do catálogo', () => {
    const { total, cell } = matrixCounts(facts, { dbscan1: '19c' });
    expect(total.get('ojdbc6|11.2')).toBe(1);
    expect(cell.get('ojdbc6|11.2|19c')).toBe(1);
  });
  it('destinos de migração cobrem os bancos em uso', () => {
    const { cell } = matrixCounts(facts, { dbscan1: '19c' });
    const targets = migrationTargets('ojdbc6|11.2', cell, true);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.covers).toEqual(['19c']);
      expect(target.missing).toEqual([]);
    }
    expect(targets.some((t) => t.rowId === 'ojdbc8|19')).toBe(true);
    expect(targets.some((t) => t.rowId === 'ojdbc8|12.2')).toBe(false);
  });
});
