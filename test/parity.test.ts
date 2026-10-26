import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/domain/inventory';

/**
 * Paridade com o protótipo Python (build_facts.py), sobre exportações reais. Roda só quando as variáveis apontam arquivos
 * (os dados do cliente não ficam no repositório):
 *   JDBCMAP_SAMPLE=/caminho/inventario.json JDBCMAP_FACTS=/caminho/facts.json npm test
 */
const sample = process.env.JDBCMAP_SAMPLE;
const reference = process.env.JDBCMAP_FACTS;
const enabled = Boolean(sample && reference && existsSync(sample) && existsSync(reference));

describe.skipIf(!enabled)('paridade com o protótipo', () => {
  it('gera os mesmos fatos que o protótipo', () => {
    const snapshot = buildSnapshot(JSON.parse(readFileSync(sample as string, 'utf8')));
    const expected = JSON.parse(readFileSync(reference as string, 'utf8')) as Record<string, unknown>[];
    expect(snapshot.facts).toHaveLength(expected.length);
    snapshot.facts.forEach((fact, index) => {
      const ref = expected[index] as Record<string, unknown>;
      expect({ ds: fact.ds, server: fact.server, sv: fact.serverVersion, jdk: fact.jdk, dbt: fact.dbType, dbh: fact.dbHost, drv: fact.driverVersion, jar: fact.jar, res: fact.resolution, os: fact.os })
        .toEqual({ ds: ref.ds, server: ref.srv, sv: ref.sv, jdk: ref.jdk, dbt: ref.dbt, dbh: ref.dbh, drv: ref.drv, jar: ref.jar, res: ref.res, os: ref.os });
    });
  });
});
