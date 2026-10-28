import type { MigrationTarget } from '../domain/analysis';
import { hasDbVersions, matrixCounts, matrixRowOf, migrationTargets, statusOf } from '../domain/analysis';
import type { Fact } from '../domain/types';
import type { MatrixRow } from '../rules/compat';
import { DB_VERSIONS, INFERRED, JAR_JDBC, JAR_NOTES, MATRIX, MATRIX_ROWS, RULES_INFO, WEBLOGIC_NOTES } from '../rules/compat';
import type { State } from '../state';
import { esc } from './html';

const SYMBOL = { ok: '✓', legacy: '◐', bad: '✕', nv: '?' } as const;
const TITLE = {
  ok: 'Certificado (Yes)',
  legacy: 'Suportado, fora de suporte (Was)',
  bad: 'Sem certificação da Oracle: a combinação não consta como certificada. Pode até conectar, mas a Oracle não dá suporte',
  nv: 'Não verificado: as docs lidas não cobrem esta combinação',
} as const;

/** Matriz jar × versão do banco, com onde você está hoje e os destinos de migração da linha selecionada. */
export function renderMatrix(state: State, facts: Fact[]): string {
  const withLine = facts.filter((fact) => fact.driverVersion);
  const { total, cell } = matrixCounts(withLine, state.catalog);
  const known = hasDbVersions(withLine, state.catalog);
  const selected = state.matrixSelection;
  const rowFacts = new Map<string, Fact[]>();
  for (const fact of withLine) {
    const id = matrixRowOf(fact)?.id;
    if (id) rowFacts.set(id, [...(rowFacts.get(id) ?? []), fact]);
  }

  const versions = new Map<string, Set<string>>();
  const servers = new Map<string, Map<string, { label: string; jdk: string; count: number }>>();
  for (const fact of withLine) {
    const row = matrixRowOf(fact);
    if (row && fact.driverVersion) {
      const set = versions.get(row.id) ?? new Set<string>();
      set.add(fact.driverVersion.split('.').slice(0, 2).join('.'));
      versions.set(row.id, set);
      const label = serverLabel(fact);
      const jdk = fact.jdk ?? '—';
      const byServer = servers.get(row.id) ?? new Map<string, { label: string; jdk: string; count: number }>();
      const entry = byServer.get(`${label}|${jdk}`) ?? { label, jdk, count: 0 };
      entry.count++;
      byServer.set(`${label}|${jdk}`, entry);
      servers.set(row.id, byServer);
    }
  }

  let html = `<h3>Quais bancos cada driver atende, onde você está hoje e para onde dá para migrar</h3>
  <div class="legend"><span><b style="color:var(--ok)">✓</b> certificado pela Oracle</span><span><b style="color:var(--legacy)">◐</b> funciona, mas o driver ou o banco já saiu do suporte</span><span><b style="color:var(--bad)">✕</b> sem certificação da Oracle (pode conectar, mas sem suporte)</span><span><b style="color:var(--mute)">?</b> não verificado</span><span><b style="background:var(--ink);color:var(--bg);border-radius:999px;padding:0 7px">n</b> conexões suas nessa combinação</span></div>
  <table class="mx"><tr><th>Qtd</th><th>Servidor de aplicação</th><th>JDK</th><th>Driver</th>${DB_VERSIONS.map((db) => `<th style="text-align:center">Oracle ${esc(db)}</th>`).join('')}<th style="text-align:center">Conexões hoje</th><th>Migrar para</th></tr>`;
  const f = state.filters;
  const narrowed = f.servers.size + f.jars.size + f.ranges.size + f.oses.size + f.envs.size + f.statuses.size > 0 || f.query !== '';
  const visibleRows: MatrixRow[] = [];
  for (const row of MATRIX_ROWS) {
    const isSelected = selected === row.id;
    const mine = rowFacts.get(row.id) ?? [];
    const summary = mine.length > 0 ? migrateSummary(row.id, cell, known, mine, state) : '';
    // Com filtro ativo, linhas sem nenhuma conexão só ficam se forem a selecionada.
    if (narrowed && !total.get(row.id) && !isSelected) continue;
    visibleRows.push(row);
    const note = JAR_NOTES[row.jar];
    html += `<tr class="${isSelected ? 'row-sel' : ''}"><th class="rl srv qty" data-action="matrix-row" data-row="${esc(row.id)}">${serversLine(servers.get(row.id), 'count')}</th><th class="rl srv" data-action="matrix-row" data-row="${esc(row.id)}">${serversLine(servers.get(row.id), 'label')}</th><th class="rl srv jdk" data-action="matrix-row" data-row="${esc(row.id)}">${serversLine(servers.get(row.id), 'jdk')}</th><th class="rl" data-action="matrix-row" data-row="${esc(row.id)}">${esc(row.jar)} <span class="mut" style="font-weight:400">· ${esc(row.release)}</span><small>${esc(row.jdk)}${note ? ` · ${esc(note)}` : ''}</small>${versionsLine(versions.get(row.id))}</th>`;
    DB_VERSIONS.forEach((db, index) => {
      const compat = MATRIX[row.line][index] ?? 'bad';
      const count = cell.get(`${row.id}|${db}`) ?? 0;
      const inferred = INFERRED.has(`${row.line}|${db}`);
      html += `<td class="c ${compat}${count ? ' cur' : ''}" title="${esc(TITLE[compat])}${inferred ? ' · não consta literalmente nas docs lidas' : ''}">${SYMBOL[compat]}${inferred ? '<sup style="font-size:10px">*</sup>' : ''}${count ? `<span class="n">${count}</span>` : ''}</td>`;
    });
    html += `<td class="hoje">${total.get(row.id) ?? '<span class="mut">·</span>'}</td><td>${summary}</td></tr>`;
  }
  html += `</table><p class="sub">Em "Migrar para", cada linha mostra o destino que leva mais das suas conexões sem trocar o JDK nem o servidor (certificação do driver, JDK que o jar suporta e, no WebLogic, os bancos do My Oracle Support). Clique em uma linha para destacá-la. ${known ? 'Os bancos considerados são os do seu catálogo.' : 'Sem catálogo de versões, a conta usa todos os bancos que o driver suporta.'}
  Fonte: tabelas de interoperabilidade dos JDBC Developer's Guide 19c, 21c e 26ai da Oracle, lidas em ${esc(RULES_INFO.readAt)}. *: cruzamento que não consta literalmente nas docs lidas. ?: nenhuma das docs lidas cobre a combinação.</p>
  <p class="sub"><b>WebLogic:</b> ${WEBLOGIC_NOTES.map(esc).join(' ')} A matriz completa do WebLogic exige login no My Oracle Support.</p>
  <p class="sub"><b>Fonte das regras do WebLogic:</b> ${esc(RULES_INFO.weblogicSource)} ${esc(RULES_INFO.weblogicLimit)}</p>`;
  html += guide(visibleRows, total);
  return html;
}

/** "no seu ambiente: 23.3, 23.5" para a linha, ordenado numericamente. */
function versionsLine(set: Set<string> | undefined): string {
  if (!set || set.size === 0) return '';
  const sorted = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return `<small>no seu ambiente: ${sorted.map(esc).join(', ')}</small>`;
}

/** "WebLogic 12.2.1.4.0", ou só o tipo quando a coleta não trouxe versão. */
function serverLabel(fact: Fact): string {
  const version = fact.serverVersion;
  return !version || version === 's/ versão' ? fact.server : `${fact.server} ${version}`;
}

/**
 * Servidores de aplicação (com versão) e JDK que usam este driver no seu ambiente, com o total de conexões.
 * As colunas de quantidade, servidor e JDK usam as mesmas entradas na mesma ordem, então cada linha fica alinhada.
 */
function serversLine(byServer: Map<string, { label: string; jdk: string; count: number }> | undefined, column: 'count' | 'label' | 'jdk'): string {
  if (!byServer || byServer.size === 0) return '<span class="mut">·</span>';
  const sorted = [...byServer.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || a.jdk.localeCompare(b.jdk, undefined, { numeric: true }));
  return sorted.map((entry) => `<div class="ent">${column === 'count' ? entry.count : column === 'label' ? esc(entry.label) : esc(entry.jdk)}</div>`).join('');
}

/** Legenda da coluna Driver e tabela de referência dos jars (as mesmas linhas da matriz). */
function guide(rows: readonly MatrixRow[], total: Map<string, number>): string {
  const body = rows
    .map((row) => `<tr><td><b>${esc(row.jar)}</b></td><td>${esc(row.release)}</td><td>${esc(row.jdk)}</td><td>${esc(JAR_JDBC[row.jar] ?? '?')}</td><td style="text-align:right">${total.get(row.id) ?? '<span class="mut">·</span>'}</td></tr>`)
    .join('');
  return `<div class="guide">
  <h4>Como ler a coluna Driver</h4>
  <table class="ref">
    <tr><th>Texto na célula</th><th>O que significa</th></tr>
    <tr><td><b>ojdbc8</b></td><td>Nome do jar do driver. O número é o JDK para o qual ele foi feito, não a versão do driver.</td></tr>
    <tr><td><b>19.x</b></td><td>Release (versão) do driver. É o que se compara com a versão do banco nas colunas à direita.</td></tr>
    <tr><td><b>JDK 8, 11, 17…</b></td><td>Versões do Java em que esse jar roda. Compare com a coluna JDK do seu servidor.</td></tr>
    <tr><td><b>só JDBC 4.2</b></td><td>Nível da especificação JDBC. 4.2 é o do Java 8; 4.3 vem do Java 9 em diante. Só importa se a aplicação usar recursos do 4.3.</td></tr>
    <tr><td><b>no seu ambiente: 19.3</b></td><td>Versão exata do driver encontrada nas suas conexões desta linha. É a única parte que vem da sua coleta.</td></tr>
  </table>
  <h4>Jars da Oracle</h4>
  <table class="ref">
    <tr><th>Jar</th><th>Release</th><th>Roda em</th><th>JDBC</th><th style="text-align:right">Conexões hoje</th></tr>${body}
  </table></div>`;
}

/** "Migrar para" de uma linha: o destino que leva mais conexões dela sem trocar JDK ou servidor, e o que trava o resto. */
function migrateSummary(rowId: string, cell: Map<string, number>, known: boolean, facts: Fact[], state: State): string {
  const small = (text: string) => `<div class="mut" style="font-size:11px">${esc(text)}</div>`;
  if (facts.every((fact) => statusOf(fact, state.catalog) === 'ok')) return '<span class="mut">certificado, nada a migrar</span>';
  const targets = migrationTargets(rowId, cell, known, facts, state.catalog);
  const best = targets.filter((t) => t.usable).reduce<MigrationTarget | null>((top, t) => (top === null || t.ok > top.ok ? t : top), null);
  if (!best) {
    const ref = targets.find((t) => t.rowId === 'ojdbc8|19') ?? targets[0];
    return `<span class="mut" style="font-size:11px">sem destino:</span>${(ref?.blockers ?? ['nenhum driver tem ✓ para os bancos em uso']).map(small).join('')}`;
  }
  const row = MATRIX_ROWS.find((r) => r.id === best.rowId);
  const all = best.total > 0 && best.ok === best.total && best.missing.length === 0;
  return `<span class="tg ${all ? 'best' : ''}">${esc(row ? `${row.jar} ${row.release}` : best.rowId)}</span>`
    + `<div class="mut" style="font-size:11px">${all ? 'cobre todos' : 'cobre'}: ${best.covers.map(esc).join(', ')}</div>`
    + (best.total > 0 && best.ok < best.total ? small(`${best.ok} de ${best.total} conexões migram sem trocar JDK ou servidor`) : '')
    + (best.missing.length ? small(`${best.missing.join(', ')}: exige atualizar o banco`) : '')
    + best.blockers.map(small).join('');
}
