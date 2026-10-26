import { matches, parseCatalog, statusOf } from '../domain/analysis';
import { InventoryFormatError, buildSnapshot, previewInventory, withEnvRule } from '../domain/inventory';
import { catalogTemplate, simulateCatalog } from '../domain/simulate';
import type { Fact, Snapshot, Status } from '../domain/types';
import { emptyFilters } from '../domain/analysis';
import {
  clearCatalog, clearInventory, deleteSnapshot, getCatalog, getSettings, getSnapshot, listSnapshots, openStore, resetSettings, saveCatalog, saveSettings, saveSnapshot, type Store,
} from '../storage/db';
import { initialState, type State, type Tab } from '../state';
import { renderData } from './dataView';
import { renderDetail } from './detailView';
import { esc, percent, STATUS_ORDER, when } from './html';
import { renderMap } from './mapView';
import { renderMatrix } from './matrixView';
import { renderPlan } from './planView';
import { renderSidebar } from './sidebar';
import type { EnvRule } from '../domain/types';

const TABS: [Tab, string][] = [['map', 'Mapa de fluxo'], ['matrix', 'Matriz driver × banco'], ['plan', 'Plano de migração'], ['data', 'Coletas e dados']];
const SET_KEYS = ['dbTypes', 'jars', 'ranges', 'oses', 'servers', 'envs', 'statuses'] as const;
type SetKey = (typeof SET_KEYS)[number];

export class App {
  private state: State = initialState();
  private store!: Store;
  private facts: Fact[] = [];
  private tipHtml = new Map<string, string>();
  private armTimer: number | undefined;

  constructor(private root: HTMLElement) {}

  async start(): Promise<void> {
    this.root.innerHTML = `<header><div><h1>JdbcMap</h1><div class="sub" id="subtitle"></div></div><div class="kpis" id="kpis"></div></header>
      <div class="tabs" id="tabs"></div><main id="layout"><aside id="aside"></aside><section id="main"></section></main><div class="tip" id="tip"></div>`;
    this.bind();
    try {
      this.store = await openStore();
      this.state.settings = await getSettings(this.store);
      this.state.catalog = await getCatalog(this.store);
      this.state.catalogText = catalogTemplate([], this.state.catalog) ;
      await this.refreshSnapshots();
      const latest = this.state.snapshots[0];
      if (latest) await this.useSnapshot(latest.id);
      else this.state.tab = 'data';
    } catch (error) {
      this.state.notice = { kind: 'err', text: `Não foi possível abrir o armazenamento local do navegador: ${(error as Error).message}` };
      this.state.tab = 'data';
    }
    this.render();
  }

  // ---------- dados ----------
  private async refreshSnapshots(): Promise<void> {
    this.state.snapshots = await listSnapshots(this.store);
  }

  private async useSnapshot(id: string): Promise<void> {
    const snapshot = await getSnapshot(this.store, id);
    if (!snapshot) return;
    this.setCurrent(snapshot);
  }

  private setCurrent(snapshot: Snapshot): void {
    this.state.current = snapshot;
    this.facts = withEnvRule(snapshot.facts, this.state.settings.envRule);
    this.state.filters = emptyFilters();
    this.state.selection = null;
    this.state.matrixSelection = null;
    this.state.catalogText = catalogTemplate(this.facts.filter((f) => f.dbType === 'Oracle'), this.state.catalog);
  }

  private async importFile(file: File): Promise<void> {
    this.state.busy = `Lendo ${file.name}…`;
    this.state.notice = null;
    this.state.pending = null;
    this.state.tab = 'data';
    this.render();
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      const json: unknown = JSON.parse(await file.text());
      const info = previewInventory(json);
      this.state.pending = { fileName: file.name, json, info };
      this.state.busy = null;
    } catch (error) {
      this.state.busy = null;
      const text = error instanceof InventoryFormatError ? error.message : error instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : `Falha ao ler o arquivo: ${(error as Error).message}`;
      this.state.notice = { kind: 'err', text };
    }
    this.render();
  }

  private async confirmImport(): Promise<void> {
    const pending = this.state.pending;
    if (!pending) return;
    const mode = (this.root.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? 'replace') as 'replace' | 'add';
    this.state.busy = 'Importando…';
    this.render();
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      const snapshot = buildSnapshot(pending.json, { envRule: this.state.settings.envRule, fileName: pending.fileName });
      await saveSnapshot(this.store, snapshot, { replace: mode === 'replace', keep: this.state.settings.keepSnapshots });
      await this.refreshSnapshots();
      this.setCurrent(snapshot);
      this.state.pending = null;
      this.state.tab = 'map';
      this.state.notice = { kind: 'ok', text: `Coleta importada: ${snapshot.stats.oracleDatasources} datasources Oracle, ${snapshot.stats.hosts} máquinas.` };
    } catch (error) {
      this.state.notice = { kind: 'err', text: `A importação falhou: ${(error as Error).message}` };
    }
    this.state.busy = null;
    this.render();
  }

  private async clear(what: NonNullable<State['armed']>): Promise<void> {
    if (this.state.armed !== what) {
      this.state.armed = what;
      window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => { this.state.armed = null; this.render(); }, 6000);
      this.render();
      return;
    }
    window.clearTimeout(this.armTimer);
    this.state.armed = null;
    if (what === 'inventory') {
      await clearInventory(this.store);
      this.state.current = null;
      this.facts = [];
      await this.refreshSnapshots();
      this.state.notice = { kind: 'ok', text: 'Inventário limpo. O catálogo e as regras foram mantidos; importe a próxima coleta.' };
      this.state.tab = 'data';
    } else if (what === 'catalog') {
      await clearCatalog(this.store);
      this.state.catalog = {};
      this.state.catalogSimulated = false;
      this.state.catalogText = '';
      this.state.notice = { kind: 'ok', text: 'Catálogo de bancos limpo.' };
    } else {
      await resetSettings(this.store);
      this.state.settings = await getSettings(this.store);
      if (this.state.current) this.facts = withEnvRule(this.state.current.facts, this.state.settings.envRule);
      this.state.notice = { kind: 'ok', text: 'Regras restauradas ao padrão.' };
    }
    this.render();
  }

  private async saveRules(): Promise<void> {
    const position = Number((this.root.querySelector('#envPos') as HTMLInputElement).value);
    const letters: Record<string, string> = {};
    for (const part of (this.root.querySelector('#envLetters') as HTMLInputElement).value.split(';')) {
      const [key, ...rest] = part.split('=');
      const name = rest.join('=').trim();
      if (key && key.trim().length === 1 && name) letters[key.trim().toLowerCase()] = name;
    }
    const fallback = (this.root.querySelector('#envFallback') as HTMLInputElement).value.trim() || 'Não inferido';
    const keep = Number((this.root.querySelector('#keep') as HTMLInputElement).value);
    if (!Number.isInteger(position) || position < 2 || Object.keys(letters).length === 0 || !Number.isInteger(keep) || keep < 1) {
      this.state.notice = { kind: 'err', text: 'Regras inválidas: use posição ≥ 2, ao menos uma letra (d=Desenvolvimento; h=…) e retenção ≥ 1.' };
      this.render();
      return;
    }
    const envRule: EnvRule = { position, letters, fallback };
    this.state.settings = { envRule, keepSnapshots: keep };
    await saveSettings(this.store, this.state.settings);
    if (this.state.current) this.facts = withEnvRule(this.state.current.facts, envRule);
    this.state.notice = { kind: 'ok', text: 'Regras salvas; o ambiente das máquinas foi recalculado.' };
    this.render();
  }

  // ---------- eventos ----------
  private bind(): void {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (target) void this.act(target);
    });
    this.root.addEventListener('change', (event) => {
      const el = event.target as HTMLInputElement;
      if (el.id === 'file' && el.files?.[0]) void this.importFile(el.files[0]);
      if (el.dataset.action === 'opt') this.setOption(el.dataset.opt ?? '', el.checked);
    });
    this.root.addEventListener('input', (event) => {
      const el = event.target as HTMLInputElement;
      if (el.id === 'q') {
        this.state.filters.query = el.value.trim().toLowerCase();
        this.state.selection = null;
        this.renderMain();
        this.renderKpis();
      } else if (el.id === 'catalog') this.state.catalogText = el.value;
    });
    this.root.addEventListener('dragover', (event) => {
      if ((event.target as HTMLElement).closest('#drop')) { event.preventDefault(); this.root.querySelector('#drop')?.classList.add('over'); }
    });
    this.root.addEventListener('dragleave', () => this.root.querySelector('#drop')?.classList.remove('over'));
    this.root.addEventListener('drop', (event) => {
      if (!(event.target as HTMLElement).closest('#drop')) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file) void this.importFile(file);
    });
    this.root.addEventListener('mousemove', (event) => {
      const el = (event.target as Element).closest('[data-node],[data-link]');
      const tip = this.root.querySelector<HTMLElement>('#tip');
      if (!tip) return;
      const html = el ? this.tipHtml.get(el.getAttribute('data-node') !== null ? `n${el.getAttribute('data-node')}` : `l${el.getAttribute('data-link')}`) : undefined;
      if (!html) { tip.style.display = 'none'; return; }
      tip.innerHTML = html;
      tip.style.display = 'block';
      tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 340)}px`;
      tip.style.top = `${event.clientY + 14}px`;
    });
  }

  private setOption(name: string, value: boolean): void {
    if (name === 'showOs') this.state.showOs = value;
    else if (name === 'showJdk') this.state.showJdk = value;
    else if (name === 'includeUnresolved') this.state.filters.includeUnresolved = value;
    this.state.selection = null;
    this.render();
  }

  private async act(el: HTMLElement): Promise<void> {
    const action = el.dataset.action;
    const state = this.state;
    switch (action) {
      case 'tab': state.tab = el.dataset.tab as Tab; state.notice = null; this.render(); break;
      case 'chip': {
        const group = el.dataset.group as SetKey;
        const key = el.dataset.key ?? '';
        if (!SET_KEYS.includes(group)) break;
        const set = state.filters[group] as Set<string | Status>;
        if (set.has(key)) set.delete(key); else set.add(key);
        state.selection = null;
        this.render();
        break;
      }
      case 'reset-filters': {
        const { includeUnresolved } = state.filters;
        state.filters = { ...emptyFilters(), includeUnresolved };
        state.selection = null;
        this.render();
        break;
      }
      case 'node': {
        const column = el.dataset.column as NonNullable<State['selection']>['column'];
        const key = el.dataset.key ?? '';
        state.selection = state.selection?.column === column && state.selection.key === key ? null : { column, key };
        this.renderMain();
        break;
      }
      case 'matrix-row': state.matrixSelection = state.matrixSelection === el.dataset.row ? null : (el.dataset.row ?? null); this.renderMain(); break;
      case 'catalog-apply': await this.applyCatalog(); break;
      case 'catalog-sim': {
        state.catalog = simulateCatalog(this.facts.filter((f) => f.dbType === 'Oracle'));
        state.catalogSimulated = true;
        state.catalogText = Object.entries(state.catalog).map(([h, v]) => `${h};${v}`).join('\n');
        this.render();
        break;
      }
      case 'catalog-list':
        state.catalogText = catalogTemplate(this.facts.filter((f) => f.dbType === 'Oracle'), state.catalog);
        this.renderAside();
        break;
      case 'snapshot-use': await this.useSnapshot(el.dataset.id ?? ''); state.tab = 'map'; this.render(); break;
      case 'snapshot-delete': {
        const id = el.dataset.id ?? '';
        await deleteSnapshot(this.store, id);
        await this.refreshSnapshots();
        if (state.current?.id === id) {
          const next = state.snapshots[0];
          if (next) await this.useSnapshot(next.id); else { state.current = null; this.facts = []; state.tab = 'data'; }
        }
        this.render();
        break;
      }
      case 'import-confirm': await this.confirmImport(); break;
      case 'import-cancel': state.pending = null; this.render(); break;
      case 'clear': await this.clear(el.dataset.what as NonNullable<State['armed']>); break;
      case 'settings-save': await this.saveRules(); break;
      default: break;
    }
  }

  private async applyCatalog(): Promise<void> {
    const { catalog, rejected } = parseCatalog(this.state.catalogText);
    this.state.catalog = catalog;
    this.state.catalogSimulated = false;
    await saveCatalog(this.store, catalog);
    this.state.notice = rejected.length > 0
      ? { kind: 'err', text: `Catálogo salvo com ${Object.keys(catalog).length} bancos. ${rejected.length} linhas ignoradas (sem versão reconhecida), a primeira é a ${rejected[0]?.line}.` }
      : { kind: 'ok', text: `Catálogo salvo: ${Object.keys(catalog).length} bancos com versão.` };
    this.render();
  }

  // ---------- desenho ----------
  private visible(): Fact[] {
    return this.facts.filter((fact) => matches(fact, this.state.filters, this.state.catalog));
  }

  render(): void {
    this.renderHeader();
    this.renderAside();
    this.renderMain();
  }

  private renderHeader(): void {
    const s = this.state;
    const snap = s.current;
    (this.root.querySelector('#subtitle') as HTMLElement).textContent = snap
      ? `${snap.stats.hosts} máquinas · ${snap.stats.facts} conexões analisadas · coleta de ${when(snap.exportedAt)} · dashboard ${snap.dashboardVersion}`
      : 'Nenhuma coleta importada';
    (this.root.querySelector('#tabs') as HTMLElement).innerHTML = TABS
      .filter(([tab]) => snap || tab === 'data')
      .map(([tab, label]) => `<button class="tab${s.tab === tab ? ' on' : ''}" data-action="tab" data-tab="${tab}">${esc(label)}</button>`).join('');
    this.renderKpis();
  }

  private renderKpis(): void {
    const s = this.state;
    const snap = s.current;
    const box = this.root.querySelector('#kpis') as HTMLElement;
    if (!snap) { box.innerHTML = ''; return; }
    const stats = snap.stats;
    const visible = this.visible();
    const counts: Record<Status, number> = { ok: 0, legacy: 0, bad: 0, nv: 0, unk: 0 };
    const seen = new Set<string>();
    for (const fact of visible) {
      const key = `${fact.ds}|${fact.server}${fact.serverVersion}${fact.driverVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[statusOf(fact, s.catalog)]++;
    }
    const known = Object.keys(s.catalog).length > 0;
    box.innerHTML = `<div class="kpi"><b>${stats.oracleDatasources}</b><span>datasources Oracle</span></div>
      <div class="kpi"><b>${percent(stats.oracleWithDriver, stats.oracleDatasources)}</b><span>com driver resolvido</span></div>
      ${known ? `<div class="kpi ok"><b>${counts.ok}</b><span>certificadas</span></div><div class="kpi warn"><b>${counts.legacy}</b><span>fora de suporte</span></div><div class="kpi bad"><b>${counts.bad}</b><span>sem certificação</span></div>` : '<div class="kpi"><b>0</b><span>bancos com versão</span></div>'}`;
  }

  private renderAside(): void {
    const aside = this.root.querySelector('#aside') as HTMLElement;
    const layout = this.root.querySelector('#layout') as HTMLElement;
    const wide = this.state.tab === 'data' || !this.state.current;
    layout.style.gridTemplateColumns = wide ? '1fr' : '';
    aside.classList.toggle('hide', wide);
    if (!wide) aside.innerHTML = renderSidebar(this.state, this.facts);
  }

  private renderMain(): void {
    const s = this.state;
    const main = this.root.querySelector('#main') as HTMLElement;
    const notice = s.notice ? `<div class="msg ${s.notice.kind}" style="margin-bottom:12px">${esc(s.notice.text)}</div>` : '';
    if (s.tab === 'data' || !s.current) { main.innerHTML = notice + renderData(s); return; }
    const facts = this.visible();
    if (s.tab === 'map') {
      const banner = Object.keys(s.catalog).length === 0
        ? '<div class="banner"><b>Versão do banco ausente.</b> A exportação traz host, porta e serviço, mas não a versão. Cole o catálogo ao lado para ver a camada de compatibilidade.</div>'
        : s.catalogSimulated ? '<div class="banner sim"><b>Versões de banco simuladas</b> para demonstração; não foram salvas.</div>' : '';
      main.innerHTML = `${notice}${banner}<div class="legend"><span><i style="background:var(--ok)"></i>certificado (Yes)</span><span><i style="background:var(--legacy)"></i>certificado, mas uma versão saiu do suporte (Was)</span><span><i style="background:var(--bad)"></i>sem certificação da Oracle</span><span><i style="background:var(--neu)"></i>versão do banco desconhecida</span><span class="mut">clique em um nó para destacar o caminho</span></div>
        <div class="card" id="stage"></div><div class="card" style="margin-top:12px" id="detail"></div>`;
      const stage = main.querySelector('#stage') as HTMLElement;
      const render = renderMap(s, facts, Math.max(900, stage.clientWidth - 24));
      stage.innerHTML = render.html;
      (main.querySelector('#detail') as HTMLElement).innerHTML = renderDetail(render.selected ?? facts, s.catalog, render.selected !== null);
      this.indexTips(render.model.nodes.flat(), render.model.links);
    } else if (s.tab === 'matrix') main.innerHTML = `${notice}<div class="card">${renderMatrix(s, facts)}</div>`;
    else main.innerHTML = `${notice}<div class="card">${renderPlan(facts, s.catalog)}</div>`;
  }

  private indexTips(nodes: { key: string; weight: number; facts: Fact[] }[], links: { from: { key: string }; to: { key: string }; weight: number }[]): void {
    this.tipHtml.clear();
    nodes.forEach((node, i) => {
      const ds = new Set(node.facts.map((f) => f.ds)).size;
      const hosts = new Set(node.facts.map((f) => f.host)).size;
      this.tipHtml.set(`n${i}`, `<b>${esc(node.key)}</b><br>${node.weight} conexões · ${ds} datasources · ${hosts} máquinas`);
    });
    links.forEach((link, i) => this.tipHtml.set(`l${i}`, `<b>${esc(link.from.key)} → ${esc(link.to.key)}</b><br>${link.weight} conexões`));
  }
}

