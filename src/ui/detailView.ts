import { statusOf, suggest } from '../domain/analysis';
import { shortHost } from '../domain/analysis';
import { dbVersionLabel, dbVersionsOf, embeddedDriverNote, jdkMajor, serverIssue } from '../domain/analysis';
import { worstStatus } from '../domain/flow';
import type { Catalog, Fact, Status } from '../domain/types';
import { STATUS_LABEL, STATUS_ORDER, esc, pill } from './html';

const LIMIT = 400;

interface DsGroup {
  fact: Fact;
  hosts: Set<string>;
  /** Quantos datasources (ids) caíram neste grupo. */
  count: number;
}

/**
 * Junta só o que é igual em tudo o que a tabela mostra (nome, servidor, driver, JDK, banco, situação).
 * Datasources de nomes diferentes nunca se juntam, mesmo na mesma máquina.
 */
export function groupDatasources(facts: Fact[], catalog: Catalog): DsGroup[] {
  const firstById = new Map<string, Fact>();
  const hostsById = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (!firstById.has(fact.ds)) firstById.set(fact.ds, fact);
    const hosts = hostsById.get(fact.ds) ?? new Set<string>();
    hosts.add(fact.host ?? '');
    hostsById.set(fact.ds, hosts);
  }
  const groups = new Map<string, DsGroup>();
  for (const [id, fact] of firstById) {
    const key = JSON.stringify([
      fact.name, fact.server, fact.serverVersion, fact.jar, fact.driverVersion, fact.jdk, fact.dbHost, fact.dbName,
      dbVersionsOf(fact, catalog), statusOf(fact, catalog), suggest(fact, catalog),
    ]);
    const group = groups.get(key) ?? { fact, hosts: new Set<string>(), count: 0 };
    for (const host of hostsById.get(id) ?? []) group.hosts.add(host);
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Tabela de datasources do mapa: o que está visível ou o que foi selecionado. */
export function renderDetail(facts: Fact[], catalog: Catalog, focused: boolean): string {
  const list = groupDatasources(facts, catalog);
  const unresolved = new Set(facts.filter((f) => !f.driverVersion).map((f) => f.ds)).size;
  let html = `<h3${focused ? ' style="margin-top:16px"' : ''}>${focused ? 'Seleção' : 'Todos os datasources visíveis'} — ${list.length} datasources distintos (${new Set(facts.map((f) => f.ds)).size} instâncias), ${new Set(facts.map((f) => f.host)).size} máquinas${unresolved ? ` · ${unresolved} sem driver resolvido` : ''}</h3>`;
  html += '<div style="max-height:340px;overflow:auto"><table><tr><th>Datasource</th><th>Servidor</th><th>Driver</th><th>JDK</th><th>Banco</th><th>Situação</th><th>Sugestão</th></tr>';
  for (const { fact, hosts } of list.slice(0, LIMIT)) {
    const status = statusOf(fact, catalog);
    const advice = suggest(fact, catalog);
    const issue = serverIssue(fact, catalog);
    const note = embeddedDriverNote(fact);
    const versions = dbVersionsOf(fact, catalog);
    const dbVersion = dbVersionLabel(versions);
    html += `<tr><td>${esc(fact.name ?? '—')}<div class="mut">${esc([...hosts].sort()[0] ?? '')}${hosts.size > 1 ? `<span title="${esc([...hosts].sort().join('\n'))}"> · ${hosts.size} máquinas</span>` : ''}</div></td>
      <td>${esc(fact.server === 'Sem servidor' ? '—' : `${fact.server} ${fact.serverVersion}`)}</td>
      <td>${esc(fact.driverVersion ? `${fact.jar ?? ''} ${fact.driverVersion}` : 'não resolvido')}${note ? `<div class="mut" title="${esc(note)}">driver trocado</div>` : ''}</td><td>${jdkMajor(fact.jdk) ?? '—'}${issue ? ` <span class="pill bad" title="${esc(issue)}">fora do certificado</span>` : ''}</td>
      <td>${esc(shortHost(fact.dbHost) ?? '—')}${dbVersion ? ` · ${esc(dbVersion)}${versions.length > 1 ? ' <span class="pill nv" title="O CMDB lista mais de uma versão para este host; a situação usa o pior caso">várias</span>' : ''}` : ''}<div class="mut">${esc(fact.dbName ?? '')}</div></td>
      <td>${pill(status)}</td><td>${advice ? esc(advice) : '<span class="mut">—</span>'}</td></tr>`;
  }
  html += `</table></div>${list.length > LIMIT ? `<div class="mut">Mostrando ${LIMIT} de ${list.length}.</div>` : ''}`;
  return html;
}

/** Valores distintos em ordem de aparição. */
function uniq(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

/** Na tela mostra até `max` valores e resume o resto ("+3"). */
function distinct(values: string[], max = 3): string {
  if (values.length === 0) return '—';
  return `${values.slice(0, max).map(esc).join(', ')}${values.length > max ? ` +${values.length - max}` : ''}`;
}

interface HostRow {
  key: string;
  host: string;
  env: string;
  os: string;
  servers: string[];
  jdks: string[];
  drivers: string[];
  dbs: string[];
  datasources: number;
  status: Status;
}

/** Uma linha por máquina, ordenada pelo nome, com o que roda nela. */
function hostRows(facts: Fact[], catalog: Catalog): HostRow[] {
  const byHost = new Map<string, Fact[]>();
  for (const fact of facts) {
    const key = fact.host ?? fact.hostId;
    byHost.set(key, [...(byHost.get(key) ?? []), fact]);
  }
  return [...byHost.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([host, list]) => {
    const first = list[0] as Fact;
    return {
      key: host,
      host,
      env: first.env,
      os: first.os,
      servers: uniq(list.map((f) => (f.server === 'Sem servidor' ? null : `${f.server} ${f.serverVersion}`))),
      jdks: uniq(list.map((f) => (jdkMajor(f.jdk) === null ? null : `JDK ${jdkMajor(f.jdk)}`))),
      drivers: uniq(list.map((f) => (f.driverVersion ? `${f.jar ?? ''} ${f.driverVersion}`.trim() : null))),
      dbs: uniq(list.flatMap((f) => dbVersionsOf(f, catalog))),
      datasources: new Set(list.map((f) => f.ds)).size,
      status: worstStatus(list, catalog),
    };
  });
}

/** Um filtro por coluna da tabela de máquinas (valem também para datasources e exportação). */
export interface DetailFilter {
  host: string;
  env: string;
  os: string;
  server: string;
  jdk: string;
  driver: string;
  db: string;
  datasources: string;
  status: Status | '';
}

export function emptyDetailFilter(): DetailFilter {
  return { host: '', env: '', os: '', server: '', jdk: '', driver: '', db: '', datasources: '', status: '' };
}

function has(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

function filterHostRows(rows: HostRow[], f: DetailFilter): HostRow[] {
  return rows.filter((r) =>
    has(r.host, f.host) && (!f.env || r.env === f.env) && has(r.os, f.os) && has(r.servers.join(' '), f.server) && has(r.jdks.join(' '), f.jdk)
    && has(r.drivers.join(' '), f.driver) && has(r.dbs.join(' '), f.db) && has(String(r.datasources), f.datasources) && (!f.status || r.status === f.status));
}

/** Fatos das máquinas que passam nos filtros de coluna. */
export function filterDetail(facts: Fact[], filter: DetailFilter, catalog: Catalog): Fact[] {
  const keep = new Set(filterHostRows(hostRows(facts, catalog), filter).map((r) => r.key));
  return facts.filter((fact) => keep.has(fact.host ?? fact.hostId));
}

function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
}

/** Tabela de máquinas com um filtro no cabeçalho de cada coluna; `facts` é a base sem filtrar. */
export function renderHosts(facts: Fact[], catalog: Catalog, filter: DetailFilter, focused: boolean): string {
  const all = hostRows(facts, catalog);
  const hosts = filterHostRows(all, filter);
  const envs = [...new Set(all.map((r) => r.env))].sort();
  const text = (key: keyof DetailFilter) => `<th class="flt"><input type="text" data-df="${key}" value="${esc(filter[key])}" placeholder="filtrar"></th>`;
  let html = `<h3>${focused ? 'Máquinas da seleção' : 'Máquinas visíveis'} — ${hosts.length}${hosts.length !== all.length ? ` de ${all.length}` : ''}</h3>`;
  html += '<div style="max-height:340px;overflow:auto"><table><tr><th>Máquina</th><th>Ambiente</th><th>Sistema</th><th>Servidor</th><th>JDK</th><th>Driver</th><th>Banco</th><th>Datasources</th><th>Situação</th></tr>';
  html += `<tr>${text('host')}<th class="flt"><select data-df="env">${option('', 'Todos', filter.env)}${envs.map((e) => option(e, e, filter.env)).join('')}</select></th>${text('os')}${text('server')}${text('jdk')}${text('driver')}${text('db')}${text('datasources')}`;
  html += `<th class="flt"><select data-df="status">${option('', 'Todas', filter.status)}${STATUS_ORDER.map((k) => option(k, STATUS_LABEL[k], filter.status)).join('')}</select></th></tr>`;
  for (const row of hosts.slice(0, LIMIT)) {
    html += `<tr><td>${esc(row.host)}</td><td>${esc(row.env)}</td><td>${esc(row.os)}</td>
      <td>${distinct(row.servers)}</td><td>${distinct(row.jdks)}</td><td>${distinct(row.drivers)}</td><td>${distinct(row.dbs)}</td>
      <td>${row.datasources}</td><td>${pill(row.status)}</td></tr>`;
  }
  if (hosts.length === 0) html += '<tr><td colspan="9" class="mut">Nenhuma máquina com esses filtros.</td></tr>';
  return `${html}</table></div>${hosts.length > LIMIT ? `<div class="mut">Mostrando ${LIMIT} de ${hosts.length}.</div>` : ''}`;
}

/** Botões de limpar filtros e exportar; ficam fora da área redesenhada a cada digitação. */
export function renderDetailToolbar(): string {
  return `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <button class="btn" data-action="detail-clear">Limpar filtros das colunas</button>
    <span style="flex:1"></span>
    <button class="btn" data-action="export" data-what="hosts">Exportar máquinas (CSV)</button>
    <button class="btn" data-action="export" data-what="datasources">Exportar datasources (CSV)</button></div>`;
}

/** Texto de célula seguro para planilha: sem fórmula injetada e com aspas quando preciso. */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number)[][]): string {
  // BOM e ponto e vírgula: o Excel em português abre direto, com acentos.
  return `\uFEFF${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

export function hostsCsv(facts: Fact[], catalog: Catalog): string {
  return toCsv([
    ['Máquina', 'Ambiente', 'Sistema', 'Servidores', 'JDK', 'Drivers', 'Versões do banco', 'Datasources', 'Situação'],
    ...hostRows(facts, catalog).map((r) => [r.host, r.env, r.os, r.servers.join(' | '), r.jdks.join(' | '), r.drivers.join(' | '), r.dbs.join(' | '), r.datasources, STATUS_LABEL[r.status]]),
  ]);
}

export function datasourcesCsv(facts: Fact[], catalog: Catalog): string {
  return toCsv([
    ['Datasource', 'Máquinas', 'Ambiente', 'Servidor', 'Driver', 'JDK', 'Banco (host)', 'Serviço', 'Versões do banco', 'Situação', 'Sugestão'],
    ...groupDatasources(facts, catalog).map(({ fact, hosts }) => [
      fact.name ?? '', [...hosts].join(' | '), fact.env, fact.server === 'Sem servidor' ? '' : `${fact.server} ${fact.serverVersion}`,
      fact.driverVersion ? `${fact.jar ?? ''} ${fact.driverVersion}`.trim() : 'não resolvido', fact.jdk ?? '', shortHost(fact.dbHost) ?? '', fact.dbName ?? '',
      dbVersionsOf(fact, catalog).join(' | '), STATUS_LABEL[statusOf(fact, catalog)], suggest(fact, catalog) ?? '',
    ]),
  ]);
}
