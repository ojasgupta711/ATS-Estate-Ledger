import type { Account, AppData, Client, EstateNode, ImportRecord } from '../types';
import { DEFAULT_ACCOUNT_TYPES } from '../types';
import { activityFromImports } from '../lib/activity';
import { DEFAULT_INSTITUTIONS, RENAMED_INSTITUTIONS, RETIRED_INSTITUTIONS } from './institutions';

// Sample data for the fictional "Jane Doe Estate" (layout follows the 9/3/2026 estate summary template).
// Account numbers are fictional except for the last four digits shown on the template.

const C1 = 'client_housten';
const REMOVED_TEST_CLIENT = 'client_castellano';
const IMP_SCHWAB = 'imp_schwab_aug';
const IMP_NW = 'imp_nw_aug';
const SCHWAB_FILE = 'Schwab August 2026.xlsx';
const NW_FILE = 'Nationwide Statement Aug 2026.csv';
const IMPORTED_AT = '2026-09-02T16:12:00.000Z';

const clients: Client[] = [
  {
    id: C1,
    name: 'Jane Doe',
    estateName: 'Jane Doe Estate',
    advisor: 'ATS Trust Team',
    notes: 'Estate summary last reviewed 9/3/2026.',
    createdAt: '2024-01-15T00:00:00.000Z',
  },
];

function node(p: Partial<EstateNode> & Pick<EstateNode, 'id' | 'clientId' | 'name' | 'type'>): EstateNode {
  return {
    parentId: null,
    distributionInfo: '',
    notes: '',
    order: 0,
    color: 'slate',
    excludeFromTotal: false,
    reportColumn: 'auto',
    ...p,
  };
}

const nodes: EstateNode[] = [
  node({
    id: 'n_qual',
    clientId: C1,
    name: 'Jane Doe Qualified',
    type: 'Qualified',
    color: 'peach',
    reportColumn: 'left',
    order: 1,
    distributionInfo:
      '2023 RMD - $60,180\n2024 RMD - $71,120\n2025 RMD - $88,020\n2026 Total RMD - $100,230.40 (NW $91,050; Schwab $9,180)\nFederal 22% $22,051, State 10% $10,023 - Total tax withheld $32,074',
  }),
  node({ id: 'n_minor', clientId: C1, name: 'Jane Doe Minors', type: 'Minor', color: 'gold', reportColumn: 'left', order: 2 }),
  node({
    id: 'n_crt',
    clientId: C1,
    name: 'Doe CRT',
    type: 'CRT',
    color: 'slate',
    reportColumn: 'left',
    order: 3,
    distributionInfo: '8.00% unitrust payout. 2026 distribution $68,683.38.',
    crt: {
      initialDate: '2009-09-29',
      initialValue: 854166.67,
      netProceeds: 837083.33,
      payoutRate: 8,
      fmvAsOfDate: '2025-12-31',
      fmvAsOf: 815463.22,
      rows: [
        [2010, 844161.96, 67532.96],
        [2011, 881555.2, 70524.42],
        [2012, 750757.71, 60060.62],
        [2013, 734798.14, 58783.85],
        [2014, 803852.04, 64308.16],
        [2015, 768191.3, 61455.3],
        [2016, 681724.57, 54537.97],
        [2017, 671615.24, 53729.22],
        [2018, 712835.03, 57026.8],
        [2019, 620708.94, 49656.72],
        [2020, 704540.88, 56363.27],
        [2021, 891465.24, 71317.22],
        [2022, 935642.59, 74851.41],
        [2023, 638419.67, 51073.57],
        [2024, 715291.45, 57223.32],
        [2025, 815463.22, 65237.06],
        [2026, 858542.26, 68683.38],
      ].map(([year, fmv, distribution]) => ({ year, fmv, distribution })),
    },
  }),
  node({ id: 'n_1998', clientId: C1, name: 'Doe Family 1998 Trust (Jane)', type: 'Trust', color: 'sage', reportColumn: 'right', order: 4 }),
  node({
    id: 'n_fam',
    clientId: C1,
    parentId: 'n_1998',
    name: 'Family Trust Created under Doe Trust (Sam)',
    type: 'Family Trust',
    color: 'green',
    order: 1,
  }),
  node({
    id: 'n_child',
    clientId: C1,
    parentId: 'n_1998',
    name: "Doe Children's Trust",
    type: "Children's Trust",
    color: 'lavender',
    order: 2,
    excludeFromTotal: true,
    notes: 'Life insurance cash value shown for reference only; not included in the estate total.',
  }),
  node({
    id: 'n_tcrt',
    clientId: C1,
    name: 'Doe Testamentary CRT',
    type: 'CRT',
    color: 'blue',
    reportColumn: 'right',
    order: 5,
    notes: 'Funded at death under the estate plan.',
  }),
];

interface Seed {
  id: string;
  clientId?: string;
  name: string;
  number: string;
  institution: string;
  type: string;
  parentId: string | null;
  owner: string;
  beneficiary: string;
  value: number | null;
  dist?: number;
  freq?: Account['distributionFrequency'];
  lastUpdated: string;
  notes?: string;
  exclude?: boolean;
  src: 'schwab' | 'nw' | 'manual';
  row?: number;
}

function acct(s: Seed): Account {
  const source: Account['source'] =
    s.src === 'manual'
      ? { kind: 'manual' }
      : s.src === 'schwab'
        ? { kind: 'import', fileName: SCHWAB_FILE, importId: IMP_SCHWAB, importedAt: IMPORTED_AT, institution: 'Charles Schwab', sheet: 'Positions', row: s.row }
        : { kind: 'import', fileName: NW_FILE, importId: IMP_NW, importedAt: IMPORTED_AT, institution: 'Nationwide', row: s.row };
  const sourceLabel = source.kind === 'manual' ? 'Manual entry' : source.fileName!;
  return {
    id: s.id,
    clientId: s.clientId ?? C1,
    name: s.name,
    number: s.number,
    institution: s.institution,
    type: s.type,
    parentId: s.parentId,
    owner: s.owner,
    beneficiary: s.beneficiary,
    value: s.value,
    distributionAmount: s.dist ?? null,
    distributionFrequency: s.freq ?? '',
    lastUpdated: s.lastUpdated,
    notes: s.notes ?? '',
    excludeFromTotal: s.exclude ?? false,
    source,
    history: [{ date: source.importedAt ?? `${s.lastUpdated}T12:00:00.000Z`, value: s.value, source: sourceLabel }],
    createdAt: '2026-01-10T00:00:00.000Z',
  };
}

const accounts: Account[] = [
  // Jane Doe Qualified — $1,829,695
  acct({ id: 'a_nw_ira', name: 'Nationwide VA IRA', number: '4401-7127', institution: 'Nationwide', type: 'Qualified', parentId: 'n_qual', owner: 'Jane Doe', beneficiary: 'Doe Family 1998 Trust', value: 1683420, dist: 91050, freq: 'Annual', lastUpdated: '2026-08-31', src: 'nw', row: 2 }),
  acct({ id: 'a_sch_ira', name: 'Schwab IRA', number: '5512-4497', institution: 'Charles Schwab', type: 'Qualified', parentId: 'n_qual', owner: 'Jane Doe', beneficiary: 'Doe Family 1998 Trust', value: 146275, dist: 9180.4, freq: 'Annual', lastUpdated: '2026-08-31', src: 'schwab', row: 5 }),
  // Jane Doe Minors — $0
  acct({ id: 'a_min_sam', name: 'Schwab Minor Samuel', number: '5512-7435', institution: 'Charles Schwab', type: 'Minor', parentId: 'n_minor', owner: 'Jane Doe, Custodian', beneficiary: 'Samuel Doe', value: 0, lastUpdated: '2026-08-31', src: 'schwab', row: 6 }),
  acct({ id: 'a_min_wil', name: 'Schwab Minor William', number: '5512-4154', institution: 'Charles Schwab', type: 'Minor', parentId: 'n_minor', owner: 'Jane Doe, Custodian', beneficiary: 'William Doe', value: 0, lastUpdated: '2026-08-31', src: 'schwab', row: 7 }),
  // Doe CRT — $934,950
  acct({ id: 'a_crt_sch', name: 'Schwab Doe 2009 CRT', number: '5512-1390', institution: 'Charles Schwab', type: 'CRT', parentId: 'n_crt', owner: 'Doe 2009 CRT', beneficiary: 'Charitable remainder', value: 158640, lastUpdated: '2026-08-31', src: 'schwab', row: 8 }),
  acct({ id: 'a_crt_nw', name: 'Nationwide VA CRT', number: '4401-6204', institution: 'Nationwide', type: 'CRT', parentId: 'n_crt', owner: 'Doe 2009 CRT', beneficiary: 'Charitable remainder', value: 776310, lastUpdated: '2026-08-31', src: 'nw', row: 3 }),
  // Doe Family 1998 Trust (Jane) — $2,142,345
  acct({ id: 'a_ft_5038', name: 'Schwab Doe Family 1998 Trust', number: '5512-5038', institution: 'Charles Schwab', type: 'Trust', parentId: 'n_1998', owner: 'Doe Family 1998 Trust', beneficiary: 'Per trust terms', value: 1512385, lastUpdated: '2026-08-31', src: 'schwab', row: 9 }),
  acct({ id: 'a_ft_9223', name: 'Schwab Doe Family 1998 Trust', number: '5512-9223', institution: 'Charles Schwab', type: 'Trust', parentId: 'n_1998', owner: 'Doe Family 1998 Trust', beneficiary: 'Per trust terms', value: 104960, lastUpdated: '2026-08-31', src: 'schwab', row: 10 }),
  acct({ id: 'a_vi', name: 'Vi Deposit', number: '', institution: 'Other', type: 'Trust', parentId: 'n_1998', owner: 'Doe Family 1998 Trust', beneficiary: 'Per trust terms', value: 525000, lastUpdated: '2026-09-01', notes: 'Refundable residence entrance deposit.', src: 'manual' }),
  // Family Trust Created under Doe Trust (Sam) — $688,140
  acct({ id: 'a_fam_6427', name: 'Schwab Trust', number: '5512-6427', institution: 'Charles Schwab', type: 'Family Trust', parentId: 'n_fam', owner: 'Family Trust u/Doe Trust (Sam)', beneficiary: 'Jane Doe (income)', value: 688140, lastUpdated: '2026-08-31', src: 'schwab', row: 11 }),
  // Doe Children's Trust — $281,450 (excluded from estate total)
  acct({ id: 'a_lincoln', name: 'Lincoln VUL', number: '7730-2076', institution: 'Lincoln Financial', type: "Children's Trust", parentId: 'n_child', owner: "Doe Children's Trust", beneficiary: "Doe Children's Trust", value: 281450, lastUpdated: '2026-05-15', notes: 'Death Benefit $2,750,000', src: 'manual' }),
];

const imports: ImportRecord[] = [
  {
    id: IMP_SCHWAB,
    clientId: C1,
    fileName: SCHWAB_FILE,
    institution: 'Charles Schwab',
    importedAt: IMPORTED_AT,
    accountsAdded: 7,
    accountsReplaced: 0,
    accountsSkipped: 0,
    totalValue: 146275 + 0 + 0 + 158640 + 1512385 + 104960 + 688140,
    unmappedColumns: ['Day Change $', 'Cash & Cash Investments'],
    importedBy: 'demo@atsestate.com',
  },
  {
    id: IMP_NW,
    clientId: C1,
    fileName: NW_FILE,
    institution: 'Nationwide',
    importedAt: '2026-09-02T16:20:00.000Z',
    accountsAdded: 2,
    accountsReplaced: 0,
    accountsSkipped: 0,
    totalValue: 1683420 + 776310,
    unmappedColumns: [],
    importedBy: 'demo@atsestate.com',
  },
];

export const DATA_VERSION = 8;

export function createSeedData(): AppData {
  return structuredClone({
    version: DATA_VERSION,
    clients,
    nodes,
    accounts,
    imports,
    accountTypes: [...DEFAULT_ACCOUNT_TYPES],
    institutions: [...DEFAULT_INSTITUTIONS],
    mappingTemplates: [],
    activity: activityFromImports(imports),
    settings: {
      firmName: 'ATS',
      firmTagline: 'Advanced Trustee Strategies',
      logoDataUrl: null,
      internalUseLabel: true,
    },
  });
}

/** Upgrades data saved by an earlier version instead of discarding it. */
export function migrateData(raw: unknown): AppData | null {
  if (!raw || typeof raw !== 'object') return null;
  let d = raw as AppData;
  if (!Array.isArray(d.clients) || !Array.isArray(d.accounts) || !Array.isArray(d.nodes)) return null;
  if (d.version === DATA_VERSION) return d;
  if (d.version < 3 || d.version > DATA_VERSION) return null;

  if (d.version === 3) {
    // v4: managed institution list; retired institutions removed.
    const retired = new Set(RETIRED_INSTITUTIONS);
    const inUse = d.accounts.map((a) => a.institution).filter((i) => i && !retired.has(i) && !DEFAULT_INSTITUTIONS.includes(i));
    d = {
      ...d,
      version: 4,
      institutions: [...DEFAULT_INSTITUTIONS.slice(0, -1), ...new Set(inUse), 'Other'],
      // The seeded Vi Deposit used "Vi Living", which is no longer an institution.
      accounts: d.accounts.map((a) => (a.institution === 'Vi Living' ? { ...a, institution: 'Other' } : a)),
    };
  }

  if (d.version === 4) {
    // v5: institutions renamed (Corelife → Corebridge) everywhere they appear.
    const ren = (i: string) => RENAMED_INSTITUTIONS[i] ?? i;
    d = {
      ...d,
      version: 5,
      institutions: [...new Set((d.institutions ?? DEFAULT_INSTITUTIONS).map(ren))],
      accounts: d.accounts.map((a) => ({ ...a, institution: ren(a.institution), source: a.source.institution ? { ...a.source, institution: ren(a.source.institution) } : a.source })),
      imports: d.imports.map((i) => ({ ...i, institution: ren(i.institution), institutions: i.institutions?.map(ren) })),
      mappingTemplates: d.mappingTemplates.map((t) => ({ ...t, institution: ren(t.institution) })),
    };
  }

  if (d.version === 5) {
    // v6: change log. Earlier imports become its first entries.
    d = { ...d, version: 6, activity: activityFromImports(d.imports) };
  }

  if (d.version === 6) {
    // v7: the Castellano Family Estate was test data only — remove it and everything that belonged to it.
    const gone = (x: { clientId: string }) => x.clientId !== REMOVED_TEST_CLIENT;
    d = {
      ...d,
      version: 7,
      clients: d.clients.filter((c) => c.id !== REMOVED_TEST_CLIENT),
      nodes: d.nodes.filter(gone),
      accounts: d.accounts.filter(gone),
      imports: d.imports.filter(gone),
      activity: (d.activity ?? []).filter(gone),
    };
  }

  if (d.version === 7) {
    // v8: the sample client is now the fictional Jane Doe, with new sample values.
    // Replace the old sample estate with the new one; other clients are kept as they are.
    const seed = createSeedData();
    const other = (x: { clientId: string }) => x.clientId !== C1;
    d = {
      ...d,
      version: 8,
      clients: [...seed.clients, ...d.clients.filter((c) => c.id !== C1)],
      nodes: [...seed.nodes, ...d.nodes.filter(other)],
      accounts: [...seed.accounts, ...d.accounts.filter(other)],
      imports: [...seed.imports, ...d.imports.filter(other)],
      activity: [...(seed.activity ?? []), ...(d.activity ?? []).filter(other)],
    };
  }
  return d;
}
