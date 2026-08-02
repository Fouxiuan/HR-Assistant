import type { CandidateCard } from '../../shared/contracts.js';

export function candidateIdentity(card: Pick<
  CandidateCard,
  'sourceId' | 'name' | 'education' | 'years' | 'expected' | 'salary' | 'advantage'
>): string {
  if (card.sourceId?.trim()) return `source:${card.sourceId.trim()}`;
  return ['fallback', card.name, card.education, card.years, card.expected, card.salary, card.advantage]
    .map(value => String(value ?? '').trim())
    .join('\u001f');
}
