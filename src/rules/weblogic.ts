import type { DbVersion } from '../domain/types';
import data from './weblogic.json';

/** Uma versão do WebLogic como o My Oracle Support a certifica (gerado de matriz/weblogic por `npm run matriz`). */
export interface WeblogicRule {
  version: string;
  database: readonly { usage: string; ai: boolean; version: string; type: string }[];
  jdk: readonly { version: string; type: string }[];
}

export const WEBLOGIC_RULES: readonly WeblogicRule[] = data.servers;
export const WEBLOGIC_SOURCE = { readAt: data.readAt, origin: data.origin };

/** Regra da versão do servidor ("12.2.1.4.0" → 12.2.1.4); null para versões que o MOS não cobre. */
export function weblogicRule(serverVersion: string): WeblogicRule | null {
  return WEBLOGIC_RULES.find((rule) => serverVersion === rule.version || serverVersion.startsWith(`${rule.version}.`)) ?? null;
}

/** Colunas da matriz que o WebLogic certifica (a "Oracle AI Database 23.26" é a 26ai); o banco do repositório (RCU) não conta. */
export function certifiedDbs(rule: WeblogicRule, normalize: (text: string) => DbVersion | null): Set<DbVersion> {
  const found = new Set<DbVersion>();
  for (const db of rule.database) {
    if (db.usage === 'rcu') continue;
    const column = db.ai ? '26ai' : normalize(db.version);
    if (column) found.add(column);
  }
  return found;
}
