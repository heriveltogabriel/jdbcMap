import { DRIVER_LINES } from '../rules/compat';
import { driverLine } from '../domain/analysis';
import { COLUMN_TITLES, buildFlow, layoutFlow, worstStatus, type Column, type FlowModel, type FlowNode } from '../domain/flow';
import type { Catalog, Fact } from '../domain/types';
import type { State } from '../state';
import { esc } from './html';

const LINE_COLORS = ['#c0504d', '#d6803c', '#d9a63a', '#8fb04a', '#3d9b86', '#3b84c2', '#5b6fd0', '#8a5bd0'];
const LINK_COLOR = { ok: 'var(--ok)', legacy: 'var(--legacy)', bad: 'var(--bad)', nv: 'var(--neu)', unk: 'var(--neu)' } as const;

function columns(state: State): Column[] {
  return [...(state.showOs ? (['os'] as const) : []), 'server', ...(state.showJdk ? (['jdk'] as const) : []), 'driver', 'db'];
}

function nodeColor(node: FlowNode, catalog: Catalog): string {
  if (node.column === 'driver') {
    const fact = node.facts.find((f) => driverLine(f.driverVersion));
    const line = fact ? driverLine(fact.driverVersion) : null;
    return line ? (LINE_COLORS[DRIVER_LINES.indexOf(line)] ?? 'var(--unk)') : 'var(--unk)';
  }
  if (node.column === 'db') {
    const status = worstStatus(node.facts, catalog);
    return status === 'unk' || status === 'nv' ? 'var(--neu)' : LINK_COLOR[status];
  }
  return 'var(--acc)';
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface MapRender {
  html: string;
  model: FlowModel;
  /** Fatos da seleção (ou null), para a tabela de detalhe. */
  selected: Fact[] | null;
}

/** Monta o mapa de fluxo em SVG. A geometria sai do domínio; aqui só desenhamos. */
export function renderMap(state: State, facts: Fact[], availableWidth: number): MapRender {
  const model = buildFlow(facts, columns(state), state.catalog);
  const width = Math.max(900, availableWidth);
  const layout = layoutFlow(model, width);
  const selectedNode = state.selection ? model.nodes.flat().find((n) => n.column === state.selection?.column && n.key === state.selection?.key) : undefined;
  const selected = selectedNode ? new Set(selectedNode.facts) : null;
  const flat = model.nodes.flat();
  const step = model.columns.length > 1 ? (width - layout.columnWidth) / (model.columns.length - 1) : 0;

  let svg = `<svg width="${width}" height="${layout.height + 10}" viewBox="0 0 ${width} ${layout.height + 10}" role="img" aria-label="Mapa de fluxo">`;
  model.columns.forEach((column, i) => {
    svg += `<text class="colh" x="${i * step}" y="14">${esc(COLUMN_TITLES[column])}</text><text class="sub2" x="${i * step}" y="27">${model.nodes[i]?.length ?? 0} grupos</text>`;
  });
  model.links.forEach((link, i) => {
    const xa = link.from.x + 14;
    const xb = link.to.x;
    const mid = (xa + xb) / 2;
    const status = link.to.column === 'db' ? worstStatus(link.facts, state.catalog) : null;
    const dim = selected && !link.facts.some((f) => selected.has(f));
    const opacity = status && status !== 'unk' && status !== 'nv' ? 0.5 : 0.28;
    svg += `<path class="link${dim ? ' dim' : ''}" data-link="${i}" d="M${xa},${link.y0} C${mid},${link.y0} ${mid},${link.y1} ${xb},${link.y1}" stroke="${status ? LINK_COLOR[status] : 'var(--neu)'}" stroke-opacity="${opacity}" stroke-width="${link.width}"/>`;
  });
  flat.forEach((node, i) => {
    const dim = selected && !node.facts.some((f) => selected.has(f));
    const on = selectedNode === node;
    const textY = node.y + Math.min(node.h / 2 + 4, 13);
    svg += `<g class="node${dim ? ' dim' : ''}" data-node="${i}" data-action="node" data-column="${node.column}" data-key="${esc(node.key)}"><rect x="${node.x}" y="${node.y}" width="${layout.columnWidth}" height="${node.h}" fill="transparent" class="hit"/><rect x="${node.x}" y="${node.y}" width="14" height="${node.h}" rx="3" fill="${nodeColor(node, state.catalog)}"${on ? ' stroke="var(--ink)" stroke-width="2"' : ''}/>
      <text x="${node.x + 20}" y="${textY}">${esc(clip(node.key, 22))}</text>${node.h > 26 ? `<text class="sub2" x="${node.x + 20}" y="${textY + 13}">${node.weight} conexões</text>` : ''}</g>`;
  });
  svg += '</svg>';
  return { html: svg, model, selected: selected ? [...selected] : null };
}
