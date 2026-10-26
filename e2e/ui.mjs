// Teste de interface ponta a ponta com Chrome real (playwright-core). Uso: npm run build && npm run e2e
// Variáveis: CHROME (caminho do Chrome), JDBCMAP_SAMPLE (exportação real, opcional; só roda a importação e tira capturas).
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-core';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const server = createServer((req, res) => {
  const path = join(dist, req.url === '/' ? 'index.html' : (req.url ?? '').split('?')[0] ?? '');
  if (!existsSync(path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;

const dir = mkdtempSync(join(tmpdir(), 'jdbcmap-e2e-'));
const exportJson = (exportedAt) => ({
  metadata: { format: 'java-assessment-inventory', formatVersion: 2, dashboardVersion: '2.1.22', exportedAt, label: 'e2e', containsCredentials: false, counts: { hosts: 2, datasources: 2 } },
  data: {
    environments: [{ id: 'e1', name: 'Desenvolvimento' }],
    hosts: [{ id: 'h1', environmentId: 'e1', hostname: 'n121p000001', distribution: 'Red Hat Enterprise Linux release 8.9 (Ootpa)' }, { id: 'h2', environmentId: 'e1', hostname: 'n121d000002', distribution: 'Red Hat Enterprise Linux release 8.9 (Ootpa)' }],
    servers: [{ id: 's1', hostId: 'h1', type: 'WebLogic', version: '12.2.1.4.0' }],
    processes: [{ hostId: 'h1', pid: 1, javaVersion: '1.8.0_251', serverType: 'WebLogic' }, { hostId: 'h2', pid: 2, javaVersion: '17.0.7' }],
    applications: [],
    datasources: [
      { id: 'd1', hostId: 'h1', name: 'OrdersDS', databaseType: 'Oracle', databaseHost: 'dbscan1.example.net', databasePort: 1521, databaseName: 'orders', associations: [{ pid: 1, serverId: 's1', driverResult: { driverResolution: 'IDENTIFIED', driverVersion: '11.2.0.4.0', driverArtifact: '/lib/ojdbc6.jar' } }] },
      { id: 'd2', hostId: 'h2', name: 'BillDS', databaseType: 'Oracle', databaseHost: 'dbscan2.example.net', databasePort: 1521, databaseName: 'bill', driverVersion: '19.3.0.0.0', driverArtifact: '/lib/ojdbc8.jar', associations: [{ pid: 2 }] },
    ],
  },
});
const file1 = join(dir, 'inventario-1.json'); writeFileSync(file1, JSON.stringify(exportJson('2026-10-20T10:00:00Z')));
const file2 = join(dir, 'inventario-2.json'); writeFileSync(file2, JSON.stringify(exportJson('2026-10-26T10:00:00Z')));
const bad = join(dir, 'ruim.json'); writeFileSync(bad, '{"metadata":{"format":"outro"},"data":{}}');
const notJson = join(dir, 'texto.json'); writeFileSync(notJson, 'isto não é json');

let failures = 0;
const check = (ok, message, detail) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${message}${!ok && detail !== undefined ? ` → ${detail}` : ''}`); if (!ok) failures++; };

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const problems = [];
page.on('pageerror', (error) => problems.push(error.message));
page.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });
const text = async (selector) => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');

await page.goto(url);
await page.waitForSelector('#drop');
check(true, 'abre na tela de importação sem coleta');

await page.setInputFiles('#file', notJson);
await page.waitForSelector('.msg.err');
check((await text('.msg.err')).includes('JSON válido'), 'arquivo que não é JSON é recusado com mensagem');
await page.setInputFiles('#file', bad);
await page.waitForFunction(() => document.querySelector('.msg.err')?.textContent?.includes('Java Assessment'));
check(true, 'JSON de outro formato é recusado com mensagem');

await page.setInputFiles('#file', file1);
await page.waitForSelector('[data-action="import-confirm"]');
check((await text('#main')).includes('dashboard 2.1.22'), 'prévia mostra versão e data do arquivo');
await page.click('[data-action="import-confirm"]');
await page.waitForSelector('svg[aria-label="Mapa de fluxo"]');
check((await text('#kpis')).includes('2') && (await text('#subtitle')).includes('2 máquinas'), 'importa e abre o mapa de fluxo');
check((await page.locator('.node').count()) >= 5, 'o mapa desenha nós');
check((await text('#aside')).includes('Homologação') === false && (await text('#aside')).includes('Produção'), 'ambiente vem do hostname (p = Produção, apesar do cadastro Desenvolvimento)');

await page.click('.node[data-column="driver"] >> nth=0');
check((await page.locator('.dim').count()) > 0, 'clicar em um nó destaca o caminho');

await page.click('[data-tab="matrix"]');
await page.waitForSelector('.mx');
await page.click('th.rl[data-row="ojdbc6|11.2"]');
check((await page.locator('.row-tgt').count()) > 0, 'matriz: selecionar a linha mostra destinos de migração');

await page.fill('#catalog', 'dbscan1.example.net;21c\ndbscan2.example.net;19c');
await page.click('[data-action="catalog-apply"]');
await page.waitForFunction(() => document.querySelector('#main .msg.ok')?.textContent?.includes('Catálogo salvo'));
check((await text('#kpis')).includes('não listadas'), 'catálogo aplicado calcula a compatibilidade', await text('#kpis'));
await page.click('[data-tab="plan"]');
check((await text('#main')).includes('Trocar o driver'), 'plano de migração sugere a troca do driver');

await page.reload();
await page.waitForSelector('#kpis .kpi');
check((await text('#subtitle')).includes('2 máquinas'), 'os dados persistem ao recarregar a página');

await page.click('[data-tab="data"]');
await page.setInputFiles('#file', file2);
await page.waitForSelector('[data-action="import-confirm"]');
await page.check('input[name="mode"][value="add"]');
await page.click('[data-action="import-confirm"]');
await page.click('[data-tab="data"]');
check((await page.locator('.snap').count()) === 2, 'adicionar mantém as duas coletas');
await page.click('[data-action="snapshot-delete"] >> nth=1');
await page.waitForFunction(() => document.querySelectorAll('.snap').length === 1);
check((await page.locator('.snap').count()) === 1, 'remover uma coleta deixa a outra', await page.locator('.snap').count());

await page.click('[data-action="clear"][data-what="inventory"]');
check((await text('[data-what="inventory"]')).startsWith('Confirmar'), 'limpar pede segunda confirmação');
await page.click('[data-action="clear"][data-what="inventory"]');
await page.waitForFunction(() => document.querySelector('#main .msg.ok')?.textContent?.includes('Inventário limpo'));
check((await page.locator('.snap').count()) === 0 && (await text('#main')).includes('Inventário limpo'), 'inventário limpo');
await page.reload();
await page.waitForSelector('#drop');
await page.setInputFiles('#file', file1);
await page.click('[data-action="import-confirm"]');
await page.waitForSelector('svg[aria-label="Mapa de fluxo"]');
check((await text('#kpis')).includes('não listadas'), 'o catálogo sobrevive à limpeza do inventário');

const sample = process.env.JDBCMAP_SAMPLE;
if (sample && existsSync(sample)) {
  await page.click('[data-tab="data"]');
  await page.setInputFiles('#file', sample);
  await page.waitForSelector('[data-action="import-confirm"]', { timeout: 60000 });
  await page.click('[data-action="import-confirm"]');
  await page.waitForSelector('svg[aria-label="Mapa de fluxo"]', { timeout: 60000 });
  await page.screenshot({ path: join(dir, 'real-map.png') });
  await page.click('[data-tab="matrix"]');
  await page.screenshot({ path: join(dir, 'real-matrix.png') });
  console.log(`capturas em ${dir}`);
}

check(problems.length === 0, `sem erros no console (${problems.join(' | ') || 'nenhum'})`);
await browser.close();
server.close();
console.log(failures === 0 ? 'E2E_UI=PASS' : `E2E_UI=FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
