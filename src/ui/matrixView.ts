import { matrixCounts, matrixRowOf, migrationTargets } from '../domain/analysis';
import type { Fact } from '../domain/types';
import { DB_VERSIONS, INFERRED, JAR_NOTES, MATRIX, MATRIX_ROWS, RULES_INFO } from '../rules/compat';
import type { State } from '../state';
import { esc } from './html';

const SYMBOL = { ok: '✓', legacy: '◐', bad: '✕', nv: '?' } as const;
const TITLE = {
  ok: 'Certificado (Yes)',
  legacy: 'Suportado, fora de suporte (Was)',
  bad: 'Não listado pela Oracle',
  nv: 'Não verificado: as docs lidas não cobrem esta combinação',
} as const;

/** Matriz jar × versão do banco, com onde você está hoje e os destinos de migração da linha selecionada. */
export function renderMatrix(state: State, facts: Fact[]): string {
  const withLine = facts.filter((fact) => fact.driverVersion);
  const { total, cell } = matrixCounts(withLine, state.catalog);
  const known = Object.keys(state.catalog).length > 0;
  const selected = state.matrixSelection;
  const targets = new Map((selected ? migrationTargets(selected, cell, known) : []).map((t) => [t.rowId, t]));

  const versions = new Map<string, Set<string>>();
  for (const fact of withLine) {
    const row = matrixRowOf(fact);
    if (row && fact.driverVersion) {
      const set = versions.get(row.id) ?? new Set<string>();
      set.add(fact.driverVersion.split('.').slice(0, 2).join('.'));
      versions.set(row.id, set);
    }
  }

  let html = `<h3>Quais bancos cada driver atende, onde você está hoje e para onde dá para migrar</h3>
  <div class="legend"><span><b style="color:var(--ok)">✓</b> certificado pela Oracle</span><span><b style="color:var(--legacy)">◐</b> funciona, mas o driver ou o banco já saiu do suporte</span><span><b style="color:var(--bad)">✕</b> a Oracle não lista</span><span><b style="color:var(--mute)">?</b> não verificado</span><span><b style="background:var(--ink);color:var(--bg);border-radius:999px;padding:0 7px">n</b> conexões suas nessa combinação</span></div>
  <table class="mx"><tr><th>Driver</th>${DB_VERSIONS.map((db) => `<th style="text-align:center">Oracle ${esc(db)}</th>`).join('')}<th style="text-align:center">Conexões hoje</th><th>Migrar para</th></tr>`;
  for (const row of MATRIX_ROWS) {
    const isSelected = selected === row.id;
    const target = targets.get(row.id);
    const note = JAR_NOTES[row.jar];
    html += `<tr class="${isSelected ? 'row-sel' : ''}${target ? ' row-tgt' : ''}"><th class="rl" data-action="matrix-row" data-row="${esc(row.id)}">${esc(row.jar)} <span class="mut" style="font-weight:400">· ${esc(row.release)}</span><small>${esc(row.jdk)}${note ? ` · ${esc(note)}` : ''}</small>${versionsLine(versions.get(row.id))}</th>`;
    DB_VERSIONS.forEach((db, index) => {
      const compat = MATRIX[row.line][index] ?? 'bad';
      const count = cell.get(`${row.id}|${db}`) ?? 0;
      const inferred = INFERRED.has(`${row.line}|${db}`);
      html += `<td class="c ${compat}${count ? ' cur' : ''}" title="${esc(TITLE[compat])}${inferred ? ' · não consta literalmente nas docs lidas' : ''}">${SYMBOL[compat]}${inferred ? '<sup style="font-size:10px">*</sup>' : ''}${count ? `<span class="n">${count}</span>` : ''}</td>`;
    });
    const covers = target ? `<span class="tg ${target.missing.length ? '' : 'best'}">${target.missing.length ? 'cobre ' : 'cobre todos: '}${target.covers.map(esc).join(', ')}</span>${target.missing.length ? `<div class="mut" style="font-size:11px">${target.missing.map(esc).join(', ')}: exige atualizar o banco</div>` : ''}` : '';
    html += `<td class="hoje">${total.get(row.id) ?? '<span class="mut">·</span>'}</td><td>${isSelected ? '<span class="mut">linha selecionada</span>' : covers}</td></tr>`;
  }
  html += `</table><p class="sub">Clique em uma linha para ver, nas outras, quais drivers são certificados (✓) para os bancos que ela atende hoje. ${known ? 'Os bancos considerados são os do seu catálogo.' : 'Sem catálogo de versões, a conta usa todos os bancos que o driver suporta.'}
  Fonte: tabelas de interoperabilidade dos JDBC Developer's Guide 19c, 21c e 26ai da Oracle, lidas em ${esc(RULES_INFO.readAt)}. *: cruzamento que não consta literalmente nas docs lidas. ?: nenhuma das docs lidas cobre a combinação.</p>`;
  return html;
}

/** "no seu ambiente: 23.3, 23.5" para a linha, ordenado numericamente. */
function versionsLine(set: Set<string> | undefined): string {
  if (!set || set.size === 0) return '';
  const sorted = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return `<small>no seu ambiente: ${sorted.map(esc).join(', ')}</small>`;
}
