import { RANGES, factLine, hostsWithVersion, shortHost } from '../domain/analysis';
import type { Fact } from '../domain/types';
import type { State } from '../state';
import { groupDatasources } from './detailView';
import { STATUS_LABEL, STATUS_ORDER, chip, esc } from './html';

function counts(facts: Fact[], pick: (fact: Fact) => string | null): [string, number][] {
  const map = new Map<string, number>();
  for (const fact of facts) {
    const key = pick(fact);
    if (key !== null) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Filtros e opções à esquerda. `all` são os fatos da coleta; os chips contam sobre o tipo de banco escolhido. */
export function renderSidebar(state: State, all: Fact[]): string {
  const f = state.filters;
  const byType = all.filter((fact) => f.dbTypes.size === 0 || f.dbTypes.has(fact.dbType));
  const withDriver = byType.filter((fact) => fact.driverVersion);
  const jars = counts(withDriver, (fact) => fact.jar ?? 'sem-jar').sort((a, b) => jarOrder(a[0]) - jarOrder(b[0]));
  const ranges = RANGES.map((range): [string, number] => [range.label, withDriver.filter((fact) => { const line = factLine(fact); return line !== null && range.lines.includes(line); }).length]);
  const unresolved = groupDatasources(all.filter((fact) => fact.dbType === 'Oracle'), state.catalog).filter((g) => !g.fact.driverVersion).length;
  const known = hostsWithVersion(all, state.catalog).size;
  const hostsInData = new Set(all.map((fact) => shortHost(fact.dbHost)).filter(Boolean)).size;
  return `
  <div class="card"><h3>Tipo de banco</h3><div class="chips">${counts(all, (x) => x.dbType).map(([k, n]) => chip('dbTypes', k, k, n, f.dbTypes.has(k))).join('')}</div></div>
  <div class="card"><h3>Driver JDBC (jar)</h3><div class="chips">${jars.map(([k, n]) => chip('jars', k, k === 'sem-jar' ? 'jar não identificado' : k, n, f.jars.has(k))).join('') || '<span class="mut">—</span>'}</div></div>
  <div class="card"><h3>Faixa do driver</h3><div class="chips">${ranges.map(([k, n]) => chip('ranges', k, k, n, f.ranges.has(k))).join('')}</div>
    <div class="sub" style="margin-top:6px">Marque uma ou mais faixas para isolar o que importa.</div></div>
  <div class="card"><h3>Sistema operacional</h3><div class="chips">${counts(byType, (x) => x.os).slice(0, 10).map(([k, n]) => chip('oses', k, k, n, f.oses.has(k))).join('')}</div></div>
  <div class="card"><h3>Servidor de aplicação</h3><div class="chips">${counts(byType, (x) => x.server).slice(0, 8).map(([k, n]) => chip('servers', k, k, n, f.servers.has(k))).join('')}</div></div>
  <div class="card"><h3>Ambiente <span style="text-transform:none;letter-spacing:0">(pelo hostname)</span></h3><div class="chips">${counts(byType, (x) => x.env).map(([k, n]) => chip('envs', k, k, n, f.envs.has(k))).join('')}</div></div>
  <div class="card"><h3>Situação</h3><div class="chips">${STATUS_ORDER.map((k) => chip('statuses', k, STATUS_LABEL[k], null, f.statuses.has(k))).join('')}</div></div>
  <div class="card"><h3>Busca e colunas</h3>
    <input type="text" id="q" value="${esc(f.query)}" placeholder="host, serviço, datasource, driver">
    <div class="row"><label><input type="checkbox" data-action="opt" data-opt="showOs" ${state.showOs ? 'checked' : ''}> mostrar coluna Sistema operacional</label></div>
    <div class="row"><label><input type="checkbox" data-action="opt" data-opt="showJdk" ${state.showJdk ? 'checked' : ''}> mostrar coluna JDK</label></div>
    <div class="row"><label><input type="checkbox" data-action="opt" data-opt="includeUnresolved" ${f.includeUnresolved ? 'checked' : ''}> incluir drivers não resolvidos${unresolved > 0 ? ` (${unresolved} datasources)` : ''}</label></div>
    <div class="row"><button class="btn" data-action="reset-filters">Limpar filtros e seleção</button></div></div>
  <div class="card"><h3>Catálogo de bancos (versão)</h3>
    <div class="sub" style="margin-bottom:6px">${known} de ${hostsInData} bancos com versão. Sem a versão do CMDB no inventário, cole <code>host;versão</code>, uma por linha; o catálogo vale mais que o CMDB.</div>
    <textarea id="catalog" placeholder="dbscan1.example.net;19c&#10;10.1.2.3;12.2">${esc(state.catalogText)}</textarea>
    <div class="row"><button class="btn pri" data-action="catalog-apply">Aplicar</button><button class="btn" data-action="catalog-sim">Simular</button><button class="btn" data-action="catalog-list">Listar bancos</button></div>
  </div>`;
}

function jarOrder(key: string): number {
  return key === 'sem-jar' ? 999 : parseInt(key.replace('ojdbc', ''), 10) || 998;
}
