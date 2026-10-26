import type { EnvRule } from '../domain/types';

export const DEFAULT_ENV_RULE: EnvRule = {
  position: 5,
  letters: { d: 'Desenvolvimento', h: 'Homologação', p: 'Produção' },
  fallback: 'Não inferido',
};

/**
 * Hostname no padrão de 4 caracteres (letra + 3 dígitos), depois a letra do ambiente e o restante numérico:
 * n121d004775 → d. O domínio (srv1d063.example.net) é descartado antes.
 */
export function envFromHostname(hostname: string | null | undefined, rule: EnvRule = DEFAULT_ENV_RULE): string {
  const short = (hostname ?? '').split('.')[0] ?? '';
  const prefix = rule.position - 1;
  if (prefix < 1 || short.length <= prefix) return rule.fallback;
  const shape = new RegExp(`^[a-z0-9]{${prefix}}[a-z]\\d+`, 'i');
  if (!shape.test(short)) return rule.fallback;
  const letter = short.charAt(prefix).toLowerCase();
  return rule.letters[letter] ?? rule.fallback;
}
