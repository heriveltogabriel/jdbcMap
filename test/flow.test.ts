import { describe, expect, it } from 'vitest';
import { buildFlow, groupKey, layoutFlow, worstStatus } from '../src/domain/flow';
import { buildSnapshot } from '../src/domain/inventory';
import { syntheticExport } from './fixtures';

const facts = buildSnapshot(syntheticExport()).facts.filter((f) => f.dbType === 'Oracle' && f.driverVersion);

describe('buildFlow', () => {
  it('agrupa por coluna e liga as vizinhas', () => {
    const model = buildFlow(facts, ['os', 'server', 'jdk', 'driver', 'db'], {});
    expect(model.nodes).toHaveLength(5);
    expect(model.links.length).toBeGreaterThanOrEqual(4);
    expect(model.total).toBe(2);
    for (const column of model.nodes) expect(column.reduce((sum, node) => sum + node.weight, 0)).toBe(2);
  });
  it('rotula driver, jdk e banco com a versão do catálogo', () => {
    const [wl] = facts;
    expect(wl && groupKey('driver', wl, {})).toBe('ojdbc6 11.2.0.4.0');
    expect(wl && groupKey('jdk', wl, {})).toBe('JDK 8');
    expect(wl && groupKey('db', wl, { dbscan1: '19c' })).toBe('dbscan1 · 19c');
  });
  it('agrupa os menores em "Outros" acima do limite', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...facts[0]!, driverVersion: `19.${i}.0.0.0`, ds: `d${i}` }));
    const model = buildFlow(many, ['driver'], {}, 5);
    expect(model.nodes[0]).toHaveLength(5);
    expect(model.nodes[0]?.at(-1)).toMatchObject({ other: true, key: 'Outros (26)' });
  });
});

describe('layoutFlow', () => {
  it('as alturas cabem na área e os ribbons saem dentro do nó', () => {
    const model = buildFlow(facts, ['server', 'driver', 'db'], {});
    const layout = layoutFlow(model, 900);
    for (const node of model.nodes.flat()) {
      expect(node.y + node.h).toBeLessThanOrEqual(layout.height + 1);
      for (const link of node.out) {
        expect(link.y0).toBeGreaterThanOrEqual(node.y);
        expect(link.y0).toBeLessThanOrEqual(node.y + node.h + 1);
      }
    }
  });
});

describe('worstStatus', () => {
  it('prioriza incompatível sobre o resto', () => {
    expect(worstStatus(facts, { dbscan1: '21c' })).toBe('bad');
    expect(worstStatus(facts, {})).toBe('unk');
  });
});
