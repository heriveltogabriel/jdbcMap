// Gera src/rules/weblogic.json a partir dos CSV exportados do My Oracle Support (matriz/arquivos).
// Mantém só o que o mapa usa: bancos Oracle, JDK Oracle e driver Oracle JDBC Thin. A versão do WebLogic de cada
// arquivo vem do nome ("Oracle WebLogic Server (Version 12.2.1.4.0).csv"), porque o CSV não a traz. Uso: npm run matriz
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dir = new URL('matriz/weblogic/', root);

/** "12.2.1.4.0" → "12.2.1.4" (12.2.1.x tem 4 números); "14.1.1.0.0" → "14.1.1". */
function versionOf(file) {
  const match = /Version (\d+(?:\.\d+)+)/.exec(file);
  if (!match) throw new Error(`${file}: sem versão no nome`);
  const parts = match[1].split('.');
  return parts.slice(0, parts[0] === '12' && parts[1] === '2' ? 4 : 3).join('.');
}

/** Lê CSV com campos entre aspas; o MOS escreve versões como ="9.7" para o Excel não converter. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const DB_NAME = /^Oracle (?:AI )?Database(?: \((WLS Server Features|App Data Access|Target DB for RCU)\))?$/;
const USAGE = { 'WLS Server Features': 'servidor', 'App Data Access': 'aplicacao', 'Target DB for RCU': 'rcu' };

const files = readdirSync(dir).filter((name) => name.endsWith('.csv'));
const byVersion = new Map();
for (const file of files) {
  const version = versionOf(file);
  if (byVersion.has(version)) throw new Error(`versão ${version} repetida: ${byVersion.get(version)} e ${file}`);
  byVersion.set(version, file);
}
const ordered = [...byVersion].sort(([x], [y]) => x.localeCompare(y, 'en', { numeric: true }));

const servers = [];
for (const [version, file] of ordered) {
  const [header, ...rows] = parseCsv(readFileSync(new URL(file, dir), 'utf8').replace(/^﻿/, ''));
  const col = (name) => header.indexOf(name);
  const [iName, iVersion, iType] = [col('Certified With'), col('Releases/Versions'), col('Certification Type')];
  if ([iName, iVersion, iType].includes(-1)) throw new Error(`${file}: cabeçalho inesperado (${header.join('|')})`);
  const server = { version, source: file, database: [], jdk: [], driver: [] };
  const seen = new Set();
  for (const row of rows) {
    const name = row[iName]?.trim() ?? '';
    const value = (row[iVersion] ?? '').replace(/^=/, '').replace(/^"|"$/g, '').trim();
    const type = (row[iType] ?? '').trim().toLowerCase() === 'secondary' ? 'secondary' : 'primary';
    const db = DB_NAME.exec(name);
    let kind, entry;
    if (db) { kind = 'database'; entry = { usage: USAGE[db[1]] ?? 'geral', ai: name.includes('AI Database'), version: value, type }; }
    else if (name === 'Oracle JDK') { kind = 'jdk'; entry = { version: value, type }; }
    else if (name.startsWith('Oracle JDBC Thin')) { kind = 'driver'; entry = { version: value, type }; }
    else continue;
    const key = `${kind}|${JSON.stringify(entry)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    server[kind].push(entry);
  }
  servers.push(server);
}

const out = { readAt: '2026-10-26', origin: 'My Oracle Support, aba Certifications (exportação em CSV)', servers };
writeFileSync(new URL('src/rules/weblogic.json', root), `${JSON.stringify(out, null, 2)}\n`);
for (const s of servers) console.log(`${s.version.padEnd(9)} bancos ${String(s.database.length).padStart(3)} · jdk ${String(s.jdk.length).padStart(3)} · driver ${s.driver.length}  ← ${s.source}`);
