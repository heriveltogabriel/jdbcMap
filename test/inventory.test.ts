import { describe, expect, it } from 'vitest';
import { InventoryFormatError, buildSnapshot, previewInventory, withEnvRule } from '../src/domain/inventory';
import { envFromHostname } from '../src/rules/env';
import { syntheticExport } from './fixtures';

describe('previewInventory', () => {
  it('lê o cabeçalho da exportação', () => {
    const info = previewInventory(syntheticExport());
    expect(info.dashboardVersion).toBe('2.1.22');
    expect(info.containsCredentials).toBe(false);
  });
  it('recusa arquivo que não é do Java Assessment', () => {
    expect(() => previewInventory({ metadata: { format: 'outro' }, data: {} })).toThrow(InventoryFormatError);
  });
  it('recusa versão de formato desconhecida', () => {
    const json = syntheticExport();
    json.metadata.formatVersion = 3;
    expect(() => previewInventory(json)).toThrow(/não suportada/);
  });
  it('recusa exportação sem data', () => {
    const json = syntheticExport();
    delete json.data;
    expect(() => previewInventory(json)).toThrow(/data/);
  });
});

describe('envFromHostname', () => {
  it('usa a quinta letra do hostname', () => {
    expect(envFromHostname('n121d004775')).toBe('Desenvolvimento');
    expect(envFromHostname('n121h004775')).toBe('Homologação');
    expect(envFromHostname('n121p004775')).toBe('Produção');
  });
  it('descarta o domínio e ignora caixa', () => {
    expect(envFromHostname('SRV1D063.example.net')).toBe('Desenvolvimento');
  });
  it('não infere em hostnames fora do padrão', () => {
    expect(envFromHostname('hprouing-master-0')).toBe('Não inferido');
    expect(envFromHostname('')).toBe('Não inferido');
    expect(envFromHostname(null)).toBe('Não inferido');
  });
  it('respeita uma regra configurada', () => {
    const rule = { position: 3, letters: { x: 'Teste' }, fallback: '?' };
    expect(envFromHostname('abx123', rule)).toBe('Teste');
    expect(envFromHostname('abz123', rule)).toBe('?');
  });
});

describe('buildSnapshot', () => {
  const snapshot = buildSnapshot(syntheticExport(), { importedAt: '2026-10-26T13:00:00Z' });
  const byDs = (id: string) => snapshot.facts.filter((f) => f.ds === id);

  it('gera um fato por datasource e associação', () => {
    expect(snapshot.facts).toHaveLength(4);
    expect(snapshot.id).toBe('2026-10-26T12:00:00Z');
  });
  it('lê servidor, JDK e jar do WebLogic', () => {
    const [fact] = byDs('d1');
    expect(fact).toMatchObject({ server: 'WebLogic', serverVersion: '12.2.1.4.0', jdk: '1.8.0_251', jar: 'ojdbc6', driverVersion: '11.2.0.4.0', dbName: 'ORDERS' });
  });
  it('trata Spring Boot e a versão do driver no datasource', () => {
    const [fact] = byDs('d2');
    expect(fact).toMatchObject({ server: 'Spring Boot', serverVersion: '3.4.3', jar: 'ojdbc11', driverVersion: '23.7.0.25.01', dbHost: '10.1.2.3' });
  });
  it('mantém o motivo quando o driver não foi resolvido', () => {
    const [fact] = byDs('d3');
    expect(fact?.driverVersion).toBeNull();
    expect(fact?.resolution).toBe('INCOMPLETE');
    expect(fact?.resolutionReason).toMatch(/hsperfdata/);
  });
  it('infere o ambiente pelo hostname e guarda o cadastrado', () => {
    expect(byDs('d1')[0]).toMatchObject({ env: 'Desenvolvimento', envRegistered: 'Desenvolvimento' });
    expect(byDs('d3')[0]).toMatchObject({ env: 'Produção', envRegistered: 'Producao' });
    expect(byDs('d4')[0]?.env).toBe('Não inferido');
  });
  it('resume sistemas operacionais', () => {
    expect(byDs('d1')[0]?.os).toBe('RHEL 7.2');
    expect(byDs('d2')[0]?.os).toBe('RHEL 8.9');
  });
  it('conta divergência de ambiente sem confundir acento', () => {
    // h2 (homologação pelo hostname) está cadastrado como Desenvolvimento; h3 "Producao" = Produção.
    expect(snapshot.stats.envMismatch).toBe(1);
    expect(snapshot.stats.envInferred).toMatchObject({ Desenvolvimento: 1, Homologação: 1, Produção: 1, 'Não inferido': 1 });
  });
  it('mede a cobertura de driver do Oracle e os motivos', () => {
    expect(snapshot.stats.oracleDatasources).toBe(3);
    expect(snapshot.stats.oracleWithDriver).toBe(2);
    expect(snapshot.stats.unresolved).toEqual({ INCOMPLETE: 1 });
  });
});

describe('withEnvRule', () => {
  it('recalcula o ambiente sem reimportar', () => {
    const snapshot = buildSnapshot(syntheticExport());
    const facts = withEnvRule(snapshot.facts, { position: 5, letters: { d: 'Dev' }, fallback: '?' });
    expect(facts.find((f) => f.ds === 'd1')?.env).toBe('Dev');
    expect(facts.find((f) => f.ds === 'd3')?.env).toBe('?');
  });
});
