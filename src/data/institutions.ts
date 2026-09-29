// Financial institutions / carriers ATS works with.
// The list is editable in Settings; these are the defaults for a new install.
export const DEFAULT_INSTITUTIONS = [
  'Charles Schwab',
  'Nationwide',
  'Fidelity',
  'Vanguard',
  'Lincoln Financial',
  'Pacific Life',
  'Jackson',
  'John Hancock',
  'Corebridge',
  'AXA (Equitable)',
  'Sammons',
  'Other',
];

// Institutions that used to be defaults and are no longer offered.
export const RETIRED_INSTITUTIONS = ['Morgan Stanley', 'Merrill', 'Raymond James', 'Edward Jones', 'Pershing', 'Vi Living'];

/** Institutions that were renamed: old name → new name. */
export const RENAMED_INSTITUTIONS: Record<string, string> = { Corelife: 'Corebridge' };

// How institutions tend to be written in custodian and carrier exports.
const ALIASES: [RegExp, string][] = [
  [/schwab/i, 'Charles Schwab'],
  [/nationwide/i, 'Nationwide'],
  [/fidelity/i, 'Fidelity'],
  [/vanguard/i, 'Vanguard'],
  [/lincoln/i, 'Lincoln Financial'],
  [/pac(ific)?[\s-]*life/i, 'Pacific Life'],
  [/jackson/i, 'Jackson'],
  [/hancock/i, 'John Hancock'],
  [/corebridge|core[\s-]*life|aig life|american general/i, 'Corebridge'],
  [/equitable|\baxa\b/i, 'AXA (Equitable)'],
  [/sammons|midland national|north american co/i, 'Sammons'],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Matches text from a spreadsheet ("Jackson National Life Insurance Co.", "PacLife", "Equitable")
 * to one of the user's institutions. Returns null when nothing matches.
 */
export function matchInstitution(raw: string | undefined, list: string[]): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const exact = list.find((i) => norm(i) === norm(s));
  if (exact) return exact;
  for (const [re, name] of ALIASES) {
    if (re.test(s)) return list.find((i) => i === name) ?? name;
  }
  // Partial match on a distinctive word of a user-added institution (e.g. "Allianz Life" → "Allianz").
  const words = norm(s).split(' ');
  const partial = list.find((i) => i !== 'Other' && norm(i).split(' ').every((w) => words.includes(w)));
  return partial ?? null;
}
