import type { Status } from '../domain/types';

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'Certificado',
  legacy: 'Certificado, fora de suporte',
  bad: 'Não listado pela Oracle',
  nv: 'Não verificado',
  unk: 'Banco sem versão',
};

export const STATUS_ORDER: readonly Status[] = ['ok', 'legacy', 'bad', 'nv', 'unk'];

export function pill(status: Status): string {
  return `<span class="pill ${status}">${esc(STATUS_LABEL[status])}</span>`;
}

export function chip(group: string, key: string, label: string, count: number | null, on: boolean): string {
  const total = count === null ? '' : `<small>${count}</small>`;
  return `<span class="chip${on ? ' on' : ''}" data-action="chip" data-group="${esc(group)}" data-key="${esc(key)}">${esc(label)}${total}</span>`;
}

/** Data/hora curta no fuso local, sem depender de Intl exótico. */
export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}
