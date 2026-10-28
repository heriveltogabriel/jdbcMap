import { describe, expect, it } from 'vitest';
import { driverLine, factLine, serverIssue, embeddedDriverNote, jdkMajor, matches, emptyFilters, matrixCounts, matrixRowOf, migrationTargets, normalizeDbVersion, parseCatalog, shortHost, statusOf, suggest } from '../src/domain/analysis';
import { buildSnapshot } from '../src/domain/inventory';
import type { Catalog, Fact } from '../src/domain/types';
import { MATRIX, MATRIX_ROWS, compatOf } from '../src/rules/compat';
import { syntheticExport } from './fixtures';
import { datasourcesCsv, emptyDetailFilter, filterDetail, hostsCsv } from '../src/ui/detailView';

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
    const targets = migrationTargets('ojdbc6|11.2', cell, true).filter((t) => t.usable);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.covers).toEqual(['19c']);
      expect(target.missing).toEqual([]);
    }
    expect(targets.some((t) => t.rowId === 'ojdbc8|19')).toBe(true);
    expect(targets.some((t) => t.rowId === 'ojdbc8|12.2')).toBe(false);
  });
});

describe('PostgreSQL e outros bancos', () => {
  it('driver que não é Oracle não ganha linha nem status', () => {
    const pg = fact({ dbType: 'PostgreSQL', driverVersion: '42.7.3', jar: 'postgresql' });
    expect(factLine(pg)).toBeNull();
    expect(statusOf(pg, { dbscan1: '19c' })).toBe('unk');
    expect(matrixRowOf(pg)).toBeNull();
    expect(suggest(pg, {})).toBeNull();
  });
  it('driverLine não aceita versões muito acima da 26ai', () => expect(driverLine('42.7.3')).toBeNull());
});

describe('serverIssue (certificação do MOS: JDK e banco)', () => {
  it.each(['1.8.0_211', '1.8.0_251', '1.8.0_471', '1.8.0'])('WebLogic 12.2.1.4 aceita o JDK %s', (jdk) => expect(serverIssue(fact({ jdk }))).toBeNull());
  it('JDK 8 abaixo da 211 é apontado', () => expect(serverIssue(fact({ jdk: '1.8.0_202' }))).toMatch(/1\.8\.0_211/));
  it('JDK 11 no 12.2.1.4 é apontado', () => expect(serverIssue(fact({ jdk: '11.0.2' }))).toMatch(/só com JDK 8.*JDK 11/));
  it('JDK 11 no 14.1.1 é aceito; 17 não', () => {
    expect(serverIssue(fact({ serverVersion: '14.1.1.0.0', jdk: '11.0.20' }))).toBeNull();
    expect(serverIssue(fact({ serverVersion: '14.1.1.0.0', jdk: '17.0.7' }))).toMatch(/JDK 8, 11/);
  });
  it('JDK 6 no 10.3.6 não consta (o MOS lista só o 1.7)', () => expect(serverIssue(fact({ serverVersion: '10.3.6.0', jdk: '1.6.0_45' }))).toMatch(/só com JDK 7.*JDK 6/));
  it('JDK não coletado, versão fora do MOS ou outro servidor não geram aviso', () => {
    expect(serverIssue(fact({ jdk: null }))).toBeNull();
    expect(serverIssue(fact({ serverVersion: '9.9.9.0', jdk: '17.0.7' }))).toBeNull();
    expect(serverIssue(fact({ server: 'Tomcat', jdk: '17.0.7' }))).toBeNull();
  });
  it('entra na sugestão da conexão', () => expect(suggest(fact({ jdk: '1.8.0_202' }), { dbscan1: '19c' })).toMatch(/exige JDK 8/));
});

describe('WebLogic 12.2.1.4: banco e driver de fábrica', () => {
  it('banco fora da lista do MOS é apontado; dentro dela não', () => {
    expect(serverIssue(fact({}), { dbscan1: '21c' })).toBeNull();
    expect(serverIssue(fact({}), { dbscan1: '26ai' })).toBeNull();
    expect(serverIssue(fact({ serverVersion: '14.1.2.0.0', jdk: '17.0.7' }), { dbscan1: '12c' })).toMatch(/não lista o banco 12c/);
    expect(serverIssue(fact({ serverVersion: '15.1.1.0.0', jdk: '21.0.8' }), { dbscan1: '21c' })).toMatch(/não lista o banco 21c/);
  });
  it('driver de fábrica não gera nota; outro jar ou versão gera', () => {
    expect(embeddedDriverNote(fact({}))).toBeNull();
    expect(embeddedDriverNote(fact({ jar: 'ojdbc11', driverVersion: '23.4.0.0.0' }))).toMatch(/de fábrica/);
    expect(embeddedDriverNote(fact({ driverVersion: '19.8.0.0.0' }))).toMatch(/de fábrica/);
    expect(embeddedDriverNote(fact({ serverVersion: '12.2.1.3.0', jar: 'ojdbc6' }))).toBeNull();
  });
});

describe('JDK 6 e 7: o ojdbc8 não roda', () => {
  const wls = { serverVersion: '10.3.6.0', driverVersion: '11.2.0.4.0', jar: 'ojdbc6' };
  it('JDK 6 não sugere ojdbc8, com ou sem catálogo', () => {
    const catalogs: Catalog[] = [{}, { dbscan1: '19c' }, { dbscan1: '21c' }];
    for (const catalog of catalogs) {
      const advice = suggest(fact({ ...wls, jdk: '1.6.0_45' }), catalog);
      expect(advice).toMatch(/exige JDK 8/);
      expect(advice).toMatch(/ojdbc6 12\.1/);
      expect(advice).not.toMatch(/^Migrar para ojdbc8/);
    }
  });
  it('JDK 6 com banco 21c diz que não há driver certificado', () => expect(suggest(fact({ ...wls, jdk: '1.6.0_45' }), { dbscan1: '21c' })).toMatch(/não há driver certificado/));
  it('JDK 7 aponta o ojdbc7', () => expect(suggest(fact({ ...wls, jdk: '1.7.0_80' }), {})).toMatch(/ojdbc7 12\.1/));
  it('JDK 8 continua sugerindo ojdbc8', () => expect(suggest(fact({ ...wls, jdk: '1.8.0_251' }), {})).toMatch(/ojdbc8 19/));
});

describe('sugestão pelo jar quando a versão do driver não foi resolvida', () => {
  const unresolved = { driverVersion: null, server: 'Tomcat', serverVersion: '6.0.37' };
  it('ojdbc14 em JDK 6 aponta o limite do JDK, sem sugerir ojdbc8', () => {
    const advice = suggest(fact({ ...unresolved, jar: 'ojdbc14', jdk: '1.6.0_45' }), {});
    expect(advice).toMatch(/ojdbc14 é de um driver antigo/);
    expect(advice).toMatch(/exige JDK 8/);
  });
  it('ojdbc6 em JDK 8 sugere ojdbc8 19.x', () => expect(suggest(fact({ ...unresolved, jar: 'ojdbc6', jdk: '1.8.0_251' }), {})).toMatch(/Migrar para ojdbc8 19\.x/));
  it('jar moderno, sem jar, ou banco que não é Oracle não geram sugestão', () => {
    expect(suggest(fact({ ...unresolved, jar: 'ojdbc11', jdk: '17.0.7' }), {})).toBeNull();
    expect(suggest(fact({ ...unresolved, jar: null }), {})).toBeNull();
    expect(suggest(fact({ ...unresolved, jar: 'ojdbc6', dbType: 'H2' }), {})).toBeNull();
  });
});

describe('versão do banco vinda do CMDB', () => {
  it('usa as versões do fato quando não há catálogo', () => {
    expect(statusOf(fact({ dbVersions: ['19c'] }), {})).toBe('ok');
    expect(statusOf(fact({ dbVersions: [] }), {})).toBe('unk');
  });
  it('o catálogo manual vale sozinho, acima do CMDB', () => {
    const f = fact({ driverVersion: '12.1.0.2.0', jar: 'ojdbc7', dbVersions: ['19c', '21c'] });
    expect(statusOf(f, { dbscan1: '19c' })).toBe('legacy');
  });
  it('com várias versões vale o pior caso e a sugestão avisa da ambiguidade', () => {
    const f = fact({ driverVersion: '12.1.0.2.0', jar: 'ojdbc7', jdk: '1.8.0_251', dbVersions: ['19c', '23ai'] });
    expect(statusOf(f, {})).toBe('bad');
    expect(suggest(f, {})).toContain('mais de uma versão');
  });
  it('conta a conexão em cada versão na matriz', () => {
    const { cell } = matrixCounts([fact({ dbVersions: ['18c', '19c'] })], {});
    expect(cell.get('ojdbc8|19|18c')).toBe(1);
    expect(cell.get('ojdbc8|19|19c')).toBe(1);
  });
  it('lê databaseVersions da exportação e ignora rótulos sem versão', () => {
    const json = syntheticExport();
    const ds = (json.data.datasources as Record<string, unknown>[])[0]!;
    Object.assign(ds, { databaseVersionStatus: 'multiplas', databaseVersions: ['11.2.0.4.200714', '11gR202', '19.16.0.0.0'] });
    const snap = buildSnapshot(json);
    expect(snap.facts.find((f) => f.ds === 'd1')?.dbVersions).toEqual(['11g', '19c']);
    expect(snap.stats.dbVersions?.multiple).toBe(1);
  });
});

describe('filtros e CSV das tabelas do mapa', () => {
  const facts = [
    fact({ ds: 'a', host: 'srv-a', env: 'Produção', dbVersions: ['19c'] }),
    fact({ ds: 'b', host: 'srv-b', env: 'Homologação', dbVersions: [], name: '=cmd' }),
  ];
  it('filtra por coluna: situação, ambiente, banco e máquina', () => {
    expect(filterDetail(facts, { ...emptyDetailFilter(), env: 'Produção' }, {}).map((f) => f.ds)).toEqual(['a']);
    expect(filterDetail(facts, { ...emptyDetailFilter(), db: '19c' }, {}).map((f) => f.ds)).toEqual(['a']);
    expect(filterDetail(facts, { ...emptyDetailFilter(), db: '11g' }, {}).map((f) => f.ds)).toEqual([]);
    expect(filterDetail(facts, { ...emptyDetailFilter(), status: 'ok' }, {}).map((f) => f.ds)).toEqual(['a']);
    expect(filterDetail(facts, { ...emptyDetailFilter(), host: 'SRV-B' }, {}).map((f) => f.ds)).toEqual(['b']);
  });
  it('gera CSV com BOM, ponto e vírgula e sem fórmula injetada', () => {
    const csv = datasourcesCsv(facts, {});
    expect(csv.startsWith('﻿Datasource;')).toBe(true);
    expect(csv).toContain("'=cmd;");
    expect(hostsCsv(facts, {}).split('\r\n')).toHaveLength(4);
  });
});

describe('destinos de migração levam em conta JDK e servidor', () => {
  const wls = (patch: Partial<Fact>) => fact({ server: 'WebLogic', serverVersion: '12.1.1.0', jdk: '1.6.0_45', driverVersion: '11.2.0.3.0', jar: 'ojdbc6', ...patch });
  it('JDK 6 não migra para ojdbc8; o servidor sem 19c no MOS também bloqueia', () => {
    const facts = [wls({})];
    const { cell } = matrixCounts(facts, { dbscan1: '19c' });
    const targets = migrationTargets('ojdbc6|11.2', cell, true, facts, { dbscan1: '19c' });
    const ojdbc8 = targets.find((t) => t.rowId === 'ojdbc8|19');
    expect(ojdbc8?.usable).toBe(false);
    expect(ojdbc8?.blockers.join(' ')).toMatch(/JDK 6/);
  });
  it('JDK 8 em servidor sem restrição migra para ojdbc8 19.x', () => {
    const facts = [fact({ server: 'Spring Boot', serverVersion: '2.7.18', jdk: '1.8.0_252', driverVersion: '11.2.0.4.0', jar: 'ojdbc6' })];
    const { cell } = matrixCounts(facts, { dbscan1: '19c' });
    const target = migrationTargets('ojdbc6|11.2', cell, true, facts, { dbscan1: '19c' }).find((t) => t.rowId === 'ojdbc8|19');
    expect(target?.usable).toBe(true);
    expect(target?.ok).toBe(1);
  });
});
