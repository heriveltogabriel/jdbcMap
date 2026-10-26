import { jdkMajor, shortHost, statusOf } from './analysis';
import type { Catalog, Fact, Status } from './types';

export type Column = 'os' | 'server' | 'jdk' | 'driver' | 'db';

export const COLUMN_TITLES: Record<Column, string> = {
  os: 'Sistema operacional',
  server: 'Servidor de aplicação',
  jdk: 'JDK em execução',
  driver: 'Driver JDBC',
  db: 'Banco de dados',
};

/** Rótulo do grupo da conexão em cada coluna do mapa. */
export function groupKey(column: Column, fact: Fact, catalog: Catalog): string {
  switch (column) {
    case 'os':
      return fact.os || 'Sistema não informado';
    case 'server':
      return fact.server === 'Sem servidor' ? 'Sem servidor identificado' : `${fact.server} ${fact.serverVersion}`;
    case 'jdk': {
      const major = jdkMajor(fact.jdk);
      return major === null ? 'JDK não coletado' : `JDK ${major}`;
    }
    case 'driver':
      return fact.driverVersion ? `${fact.jar ?? 'JDBC'} ${fact.driverVersion}` : 'Driver não resolvido';
    case 'db': {
      const host = shortHost(fact.dbHost);
      if (!host) return 'Banco não identificado';
      const version = catalog[host];
      return version ? `${host} · ${version}` : host;
    }
  }
}

export interface FlowNode {
  column: Column;
  key: string;
  weight: number;
  facts: Fact[];
  /** Nó que agrupa os menores quando passa do limite por coluna. */
  other: boolean;
  x: number;
  y: number;
  h: number;
  /** Pixels por conexão neste nó. */
  scale: number;
  out: FlowLink[];
  in: FlowLink[];
}

export interface FlowLink {
  from: FlowNode;
  to: FlowNode;
  weight: number;
  facts: Fact[];
  /** Espessura e posição vertical nas duas pontas, preenchidas pelo layout. */
  width: number;
  y0: number;
  y1: number;
}

export interface FlowModel {
  columns: Column[];
  nodes: FlowNode[][];
  links: FlowLink[];
  total: number;
}

export const MAX_NODES_PER_COLUMN = 16;

/** Agrupa as conexões em nós por coluna e liga colunas vizinhas. Sem geometria ainda. */
export function buildFlow(facts: Fact[], columns: Column[], catalog: Catalog, maxNodes = MAX_NODES_PER_COLUMN): FlowModel {
  const nodes: FlowNode[][] = [];
  const owner: Map<Fact, FlowNode>[] = [];
  for (const column of columns) {
    const groups = new Map<string, FlowNode>();
    for (const fact of facts) {
      const key = groupKey(column, fact, catalog);
      let node = groups.get(key);
      if (!node) groups.set(key, (node = blank(column, key)));
      node.weight++;
      node.facts.push(fact);
    }
    let ordered = [...groups.values()].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
    if (ordered.length > maxNodes) {
      const kept = ordered.slice(0, maxNodes - 1);
      const rest = ordered.slice(maxNodes - 1);
      const other = blank(column, `Outros (${rest.length})`);
      other.other = true;
      for (const node of rest) {
        other.weight += node.weight;
        other.facts.push(...node.facts);
      }
      ordered = [...kept, other];
    }
    const map = new Map<Fact, FlowNode>();
    for (const node of ordered) for (const fact of node.facts) map.set(fact, node);
    nodes.push(ordered);
    owner.push(map);
  }
  const links: FlowLink[] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    const merged = new Map<string, FlowLink>();
    const left = owner[i];
    const right = owner[i + 1];
    const leftNodes = nodes[i];
    const rightNodes = nodes[i + 1];
    if (!left || !right || !leftNodes || !rightNodes) continue;
    for (const fact of facts) {
      const from = left.get(fact);
      const to = right.get(fact);
      if (!from || !to) continue;
      const id = `${leftNodes.indexOf(from)}>${rightNodes.indexOf(to)}`;
      let link = merged.get(id);
      if (!link) merged.set(id, (link = { from, to, weight: 0, facts: [], width: 0, y0: 0, y1: 0 }));
      link.weight++;
      link.facts.push(fact);
    }
    for (const link of merged.values()) {
      link.from.out.push(link);
      link.to.in.push(link);
      links.push(link);
    }
  }
  return { columns, nodes, links, total: facts.length };
}

function blank(column: Column, key: string): FlowNode {
  return { column, key, weight: 0, facts: [], other: false, x: 0, y: 0, h: 0, scale: 0, out: [], in: [] };
}

export interface Layout {
  width: number;
  height: number;
  columnWidth: number;
  top: number;
}

/** Posiciona nós e ribbons: altura proporcional ao peso (mínimo 14 px), colunas igualmente espaçadas. */
export function layoutFlow(model: FlowModel, width: number, columnWidth = 150, top = 34, gap = 8): Layout {
  const tallest = Math.max(1, ...model.nodes.map((column) => column.length));
  const height = Math.max(380, Math.min(900, tallest * 34 + 60));
  const step = model.columns.length > 1 ? (width - columnWidth) / (model.columns.length - 1) : 0;
  const total = model.total || 1;
  model.nodes.forEach((column, index) => {
    const room = height - top - gap * (column.length - 1);
    const scale = Math.max(0.01, room / total);
    let heights = column.map((node) => Math.max(14, node.weight * scale));
    const used = heights.reduce((a, b) => a + b, 0);
    const shrink = used > room ? room / used : 1;
    heights = heights.map((h) => h * shrink);
    let y = top;
    column.forEach((node, i) => {
      const h = heights[i] ?? 14;
      node.x = index * step;
      node.y = y;
      node.h = h;
      node.scale = node.weight > 0 ? h / node.weight : 0;
      y += h + gap;
    });
  });
  for (const node of model.nodes.flat()) {
    node.out.sort((a, b) => a.to.y - b.to.y);
    node.in.sort((a, b) => a.from.y - b.from.y);
    let offset = 0;
    for (const link of node.out) {
      link.width = Math.max(1, link.weight * node.scale);
      link.y0 = node.y + offset + link.width / 2;
      offset += link.weight * node.scale;
    }
    offset = 0;
    for (const link of node.in) {
      link.y1 = node.y + offset + Math.max(1, link.weight * node.scale) / 2;
      offset += link.weight * node.scale;
    }
  }
  return { width, height, columnWidth, top };
}

/** Pior situação entre as conexões de um ribbon (bad > legacy > ok > nv > unk). */
export function worstStatus(facts: Fact[], catalog: Catalog): Status {
  const seen = new Set<Status>(facts.map((fact) => statusOf(fact, catalog)));
  for (const status of ['bad', 'legacy', 'ok', 'nv'] as const) if (seen.has(status)) return status;
  return 'unk';
}
