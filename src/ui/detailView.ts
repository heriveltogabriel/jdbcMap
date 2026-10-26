import { statusOf, suggest } from '../domain/analysis';
import { shortHost } from '../domain/analysis';
import { jdkMajor } from '../domain/analysis';
import type { Catalog, Fact } from '../domain/types';
import { esc, pill } from './html';

const LIMIT = 400;

/** Tabela de datasources do mapa: o que está visível ou o que foi selecionado. */
export function renderDetail(facts: Fact[], catalog: Catalog, focused: boolean): string {
  const byDatasource = new Map<string, { fact: Fact; hosts: Set<string> }>();
  for (const fact of facts) {
    const entry = byDatasource.get(fact.ds) ?? { fact, hosts: new Set<string>() };
    entry.hosts.add(fact.host ?? '');
    byDatasource.set(fact.ds, entry);
  }
  const list = [...byDatasource.values()];
  const unresolved = new Set(facts.filter((f) => !f.driverVersion).map((f) => f.ds)).size;
  let html = `<h3>${focused ? 'Seleção' : 'Todos os datasources visíveis'} — ${list.length} datasources, ${new Set(facts.map((f) => f.host)).size} máquinas${unresolved ? ` · ${unresolved} sem driver resolvido` : ''}</h3>`;
  html += '<div style="max-height:340px;overflow:auto"><table><tr><th>Datasource</th><th>Servidor</th><th>Driver</th><th>JDK</th><th>Banco</th><th>Situação</th><th>Sugestão</th></tr>';
  for (const { fact, hosts } of list.slice(0, LIMIT)) {
    const status = statusOf(fact, catalog);
    const advice = suggest(fact, catalog);
    const dbVersion = catalog[shortHost(fact.dbHost) ?? ''];
    html += `<tr><td>${esc(fact.name ?? '—')}<div class="mut">${esc(fact.host ?? '')}${hosts.size > 1 ? ` +${hosts.size - 1}` : ''}</div></td>
      <td>${esc(fact.server === 'Sem servidor' ? '—' : `${fact.server} ${fact.serverVersion}`)}</td>
      <td>${esc(fact.driverVersion ? `${fact.jar ?? ''} ${fact.driverVersion}` : 'não resolvido')}</td><td>${jdkMajor(fact.jdk) ?? '—'}</td>
      <td>${esc(shortHost(fact.dbHost) ?? '—')}${dbVersion ? ` · ${esc(dbVersion)}` : ''}<div class="mut">${esc(fact.dbName ?? '')}</div></td>
      <td>${pill(status)}</td><td>${advice ? esc(advice) : '<span class="mut">—</span>'}</td></tr>`;
  }
  html += `</table></div>${list.length > LIMIT ? `<div class="mut">Mostrando ${LIMIT} de ${list.length}.</div>` : ''}`;
  return html;
}
