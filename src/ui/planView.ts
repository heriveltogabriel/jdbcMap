import { jdkMajor, statusOf, suggest } from '../domain/analysis';
import type { Catalog, Fact } from '../domain/types';
import { esc } from './html';

interface Group {
  fact: Fact;
  advice: string;
  datasources: Set<string>;
  hosts: Set<string>;
  databases: Set<string>;
}

/** Ações sugeridas, agrupadas por servidor, driver e JDK. */
export function renderPlan(facts: Fact[], catalog: Catalog): string {
  const groups = new Map<string, Group>();
  for (const fact of facts) {
    const advice = suggest(fact, catalog);
    if (!advice) continue;
    const key = [fact.server, fact.serverVersion, fact.jar, fact.driverVersion, jdkMajor(fact.jdk), advice].join('|');
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { fact, advice, datasources: new Set(), hosts: new Set(), databases: new Set() }));
    group.datasources.add(fact.ds);
    group.hosts.add(fact.host ?? '');
    if (fact.dbHost) group.databases.add(fact.dbHost);
  }
  const ordered = [...groups.values()].sort((a, b) => b.datasources.size - a.datasources.size);
  const blocked = facts.filter((f) => statusOf(f, catalog) === 'bad').length;
  let html = `<h3>Ações sugeridas, agrupadas por servidor, driver e JDK</h3>${blocked ? `<p class="sub">${blocked} conexões em combinação que a Oracle não lista.</p>` : ''}
  <table><tr><th>Servidor</th><th>Driver atual</th><th>JDK</th><th>Datasources</th><th>Máquinas</th><th>Bancos</th><th>Ação</th></tr>`;
  for (const group of ordered) {
    const f = group.fact;
    html += `<tr><td>${esc(f.server === 'Sem servidor' ? '—' : `${f.server} ${f.serverVersion}`)}</td><td>${esc(`${f.jar ?? ''} ${f.driverVersion ?? ''}`)}</td><td>${jdkMajor(f.jdk) ?? '?'}</td><td>${group.datasources.size}</td><td>${group.hosts.size}</td><td>${group.databases.size}</td><td>${esc(group.advice)}</td></tr>`;
  }
  if (ordered.length === 0) html += '<tr><td colspan="7" class="mut">Nada a sugerir com os filtros atuais.</td></tr>';
  return `${html}</table>`;
}
