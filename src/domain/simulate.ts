import type { Catalog, DbVersion, Fact } from './types';
import { shortHost } from './analysis';

const PICKS: readonly DbVersion[] = ['19c', '19c', '19c', '19c', '19c', '12c', '12c', '11g', '18c', '21c'];

/** Versões de banco inventadas (determinísticas por host) só para demonstrar a camada de compatibilidade. */
export function simulateCatalog(facts: Fact[]): Catalog {
  const catalog: Catalog = {};
  const hosts = [...new Set(facts.map((fact) => shortHost(fact.dbHost)).filter((host): host is string => Boolean(host)))].sort();
  for (const host of hosts) {
    let hash = 0;
    for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    catalog[host] = PICKS[hash % PICKS.length] ?? '19c';
  }
  return catalog;
}

/** Texto `host;versão` do catálogo, e os bancos ainda sem versão (por número de conexões) com a versão em branco. */
export function catalogTemplate(facts: Fact[], catalog: Catalog): string {
  const counts = new Map<string, number>();
  for (const fact of facts) {
    const host = shortHost(fact.dbHost);
    if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([host]) => `${host};${catalog[host] ?? ''}`)
    .join('\n');
}
