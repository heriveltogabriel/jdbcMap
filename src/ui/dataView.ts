import type { State } from '../state';
import { esc, percent, when } from './html';

/** Aba "Coletas e dados": importar, escolher a coleta, qualidade, limpeza e regras. */
export function renderData(state: State): string {
  const current = state.current;
  let html = '<div class="stack">';
  html += `<div class="card"><h3>Importar coleta</h3>
    <label class="drop" id="drop" for="file"><b>Arraste o JSON exportado do dashboard</b><span class="mut">ou clique para escolher o arquivo (Administração → exportar inventário, formato java-assessment-inventory)</span></label>
    <input class="sr" id="file" type="file" accept=".json,application/json">`;
  if (state.busy) html += `<div class="msg" style="margin-top:10px">${esc(state.busy)}</div>`;
  if (state.pending) html += renderPending(state);
  html += '</div>';

  html += `<div class="card"><h3>Coletas guardadas</h3>${state.snapshots.length === 0 ? '<div class="mut">Nenhuma coleta importada.</div>' : ''}<div class="stack">`;
  for (const snap of state.snapshots) {
    const isCurrent = snap.id === current?.id;
    html += `<div class="snap${isCurrent ? ' cur' : ''}"><div><b>${esc(when(snap.exportedAt))}</b> · dashboard ${esc(snap.dashboardVersion)}${snap.label ? ` · ${esc(snap.label)}` : ''}
      <small>${snap.stats.hosts} máquinas · ${snap.stats.oracleDatasources} datasources Oracle · ${percent(snap.stats.oracleWithDriver, snap.stats.oracleDatasources)} com driver · importada em ${esc(when(snap.importedAt))}${snap.fileName ? ` de ${esc(snap.fileName)}` : ''}</small></div>
      <div class="inline">${isCurrent ? '<span class="mut">em uso</span>' : `<button class="btn" data-action="snapshot-use" data-id="${esc(snap.id)}">Usar</button>`}<button class="btn" data-action="snapshot-delete" data-id="${esc(snap.id)}">Remover</button></div></div>`;
  }
  html += '</div></div>';

  if (current) html += renderQuality(state);

  html += `<div class="card"><h3>Limpar a base</h3><div class="sub" style="margin-bottom:8px">Cada botão pede uma segunda confirmação. O que não for limpo permanece.</div><div class="hdr-actions">
    ${danger(state, 'inventory', 'Limpar inventário', 'apaga todas as coletas importadas')}
    ${danger(state, 'catalog', 'Limpar catálogo de bancos', 'apaga as versões dos bancos')}
    ${danger(state, 'settings', 'Restaurar regras', 'ambiente e retenção voltam ao padrão')}</div></div>`;

  const rule = state.settings.envRule;
  html += `<div class="card"><h3>Regras</h3><div class="grid2">
    <div><b>Ambiente pelo hostname</b><div class="sub">Letra do ambiente na posição indicada (1 = primeiro caractere).</div>
      <div class="row"><label>posição <input type="number" min="2" max="20" id="envPos" value="${rule.position}" style="width:64px"></label></div>
      <div class="row"><label>letras <input type="text" id="envLetters" value="${esc(Object.entries(rule.letters).map(([k, v]) => `${k}=${v}`).join('; '))}"></label></div>
      <div class="row"><label>fora do padrão <input type="text" id="envFallback" value="${esc(rule.fallback)}"></label></div></div>
    <div><b>Retenção</b><div class="sub">Coletas mantidas ao acumular.</div>
      <div class="row"><label>manter <input type="number" min="1" max="50" id="keep" value="${state.settings.keepSnapshots}" style="width:64px"> coletas</label></div></div></div>
    <div class="row"><button class="btn pri" data-action="settings-save">Salvar regras</button></div></div>`;
  return `${html}</div>`;
}

function danger(state: State, what: NonNullable<State['armed']>, label: string, hint: string): string {
  const armed = state.armed === what;
  return `<button class="btn danger${armed ? ' armed' : ''}" data-action="clear" data-what="${what}" title="${esc(hint)}">${armed ? `Confirmar: ${esc(label.toLowerCase())}` : esc(label)}</button>`;
}

function renderPending(state: State): string {
  const p = state.pending;
  if (!p) return '';
  const { info } = p;
  const hasData = state.snapshots.length > 0;
  const counts = Object.entries(info.counts).map(([k, v]) => `<div class="fact"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  return `<div class="stack" style="margin-top:12px"><div class="msg">Arquivo <b>${esc(p.fileName)}</b>: dashboard ${esc(info.dashboardVersion)}, exportado em ${esc(when(info.exportedAt))}${info.label ? `, rótulo “${esc(info.label)}”` : ''}.</div>
    ${info.containsCredentials ? '<div class="msg err">O arquivo declara conter credenciais. Importe só se for esperado; o JdbcMap não usa credenciais.</div>' : ''}
    <div class="grid2">${counts}</div>
    <div class="row"><label><input type="radio" name="mode" value="replace" ${hasData ? '' : 'checked'}> Substituir tudo (apaga as coletas anteriores)</label></div>
    <div class="row"><label><input type="radio" name="mode" value="add" ${hasData ? 'checked' : 'disabled'}> Adicionar às coletas guardadas (mantém até ${state.settings.keepSnapshots})</label></div>
    <div class="row"><button class="btn pri" data-action="import-confirm">Importar</button><button class="btn" data-action="import-cancel">Cancelar</button></div></div>`;
}

function renderQuality(state: State): string {
  const stats = state.current?.stats;
  if (!stats) return '';
  const env = Object.entries(stats.envInferred).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ');
  const reasons = Object.entries(stats.unresolved).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('');
  return `<div class="card"><h3>Qualidade da coleta em uso</h3><div class="grid2">
    <div class="fact"><b>${percent(stats.oracleWithDriver, stats.oracleDatasources)}</b><span>datasources Oracle com versão de driver (${stats.oracleWithDriver} de ${stats.oracleDatasources})</span></div>
    <div class="fact"><b>${stats.envMismatch}</b><span>máquinas com ambiente cadastrado diferente do hostname</span></div>
    <div class="fact"><b>${stats.hosts}</b><span>máquinas · ${env}</span></div></div>
    ${reasons ? `<table style="margin-top:10px"><tr><th>Sem versão de driver: motivo do coletor</th><th>Datasources</th></tr>${reasons}</table>` : ''}</div>`;
}
