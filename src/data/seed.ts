import type { Account, AppData, Client, EstateNode, ImportRecord } from '../types';
import { DEFAULT_ACCOUNT_TYPES } from '../types';
import { activityFromImports } from '../lib/activity';
import { DEFAULT_INSTITUTIONS, RENAMED_INSTITUTIONS, RETIRED_INSTITUTIONS } from './institutions';

// Sample data reproduces the "Elaine Housten Estate Summary" (Internal Use Only 9/3/2026).
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
    name: 'Elaine Housten',
    estateName: 'Elaine Housten Estate',
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
    name: 'Elaine Housten Qualified',
    type: 'Qualified',
    color: 'peach',
    reportColumn: 'left',
    order: 1,
    distributionInfo:
      '2023 RMD - $75,071\n2024 RMD - $88,898\n2025 RMD - $110,027\n2026 Total RMD - $125,874.95 (NW $114,391; Schwab $11,484)\nFederal 22% $27,875, State 10% $12,587 - Total tax withheld $40,280',
  }),
  node({ id: 'n_minor', clientId: C1, name: 'Elaine Housten Minors', type: 'Minor', color: 'gold', reportColumn: 'left', order: 2 }),
  node({
    id: 'n_crt',
    clientId: C1,
    name: 'Housten CRT',
    type: 'CRT',
    color: 'slate',
    reportColumn: 'left',
    order: 3,
    distributionInfo: '8.00% unitrust payout. 2026 distribution $82,709.53.',
    crt: {
      initialDate: '2009-09-29',
      initialValue: 1041666.6,
      netProceeds: 1020833.33,
      payoutRate: 8,
      fmvAsOfDate: '2025-12-31',
      fmvAsOf: 994467.34,
      rows: [
        [2010, 1029465.81, 82357.26],
        [2011, 1075067.32, 86005.39],
        [2012, 915558.18, 73244.65],
        [2013, 896095.29, 71687.62],
        [2014, 980307.36, 78424.59],
        [2015, 936818.66, 74945.49],
        [2016, 831371.43, 66503.58],
        [2017, 819042.97, 65515.73],
        [2018, 869311.01, 69537.03],
        [2019, 756962.12, 61027.47],
        [2020, 859196.2, 68724.77],
        [2021, 1087152.73, 86962.14],
        [2022, 1141027.55, 91267.54],
        [2023, 778560.57, 62284.84],
        [2024, 872306.65, 69784.53],
        [2025, 994467.34, 79557.4],
        [2026, 1047002.76, 82709.53],
      ].map(([year, fmv, distribution]) => ({ year, fmv, distribution })),
    },
  }),
  node({ id: 'n_1998', clientId: C1, name: 'Housten Family 1998 Trust (Elaine)', type: 'Trust', color: 'sage', reportColumn: 'right', order: 4 }),
  node({
    id: 'n_fam',
    clientId: C1,
    parentId: 'n_1998',
    name: 'Family Trust Created under Housten Trust (Sam)',
    type: 'Family Trust',
    color: 'green',
    order: 1,
  }),
  node({
    id: 'n_child',
    clientId: C1,
    parentId: 'n_1998',
    name: "Housten Children's Trust",
    type: "Children's Trust",
    color: 'lavender',
    order: 2,
    excludeFromTotal: true,
    notes: 'Life insurance cash value shown for reference only; not included in the estate total.',
  }),
  node({
    id: 'n_tcrt',
    clientId: C1,
    name: 'Housten Testamentary CRT',
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
  // Elaine Housten Qualified — $2,297,700
  acct({ id: 'a_nw_ira', name: 'Nationwide VA IRA', number: '4401-7127', institution: 'Nationwide', type: 'Qualified', parentId: 'n_qual', owner: 'Elaine Housten', beneficiary: 'Housten Family 1998 Trust', value: 2114747, dist: 114391, freq: 'Annual', lastUpdated: '2026-08-31', src: 'nw', row: 2 }),
  acct({ id: 'a_sch_ira', name: 'Schwab IRA', number: '5512-4497', institution: 'Charles Schwab', type: 'Qualified', parentId: 'n_qual', owner: 'Elaine Housten', beneficiary: 'Housten Family 1998 Trust', value: 182953, dist: 11483.95, freq: 'Annual', lastUpdated: '2026-08-31', src: 'schwab', row: 5 }),
  // Elaine Housten Minors — $0
  acct({ id: 'a_min_sam', name: 'Schwab Minor Samuel', number: '5512-7435', institution: 'Charles Schwab', type: 'Minor', parentId: 'n_minor', owner: 'Elaine Housten, Custodian', beneficiary: 'Samuel Housten', value: 0, lastUpdated: '2026-08-31', src: 'schwab', row: 6 }),
  acct({ id: 'a_min_wil', name: 'Schwab Minor William', number: '5512-4154', institution: 'Charles Schwab', type: 'Minor', parentId: 'n_minor', owner: 'Elaine Housten, Custodian', beneficiary: 'William Housten', value: 0, lastUpdated: '2026-08-31', src: 'schwab', row: 7 }),
  // Housten CRT — $1,125,422
  acct({ id: 'a_crt_sch', name: 'Schwab Housten 2009 CRT', number: '5512-1390', institution: 'Charles Schwab', type: 'CRT', parentId: 'n_crt', owner: 'Housten 2009 CRT', beneficiary: 'Charitable remainder', value: 193197, lastUpdated: '2026-08-31', src: 'schwab', row: 8 }),
  acct({ id: 'a_crt_nw', name: 'Nationwide VA CRT', number: '4401-6204', institution: 'Nationwide', type: 'CRT', parentId: 'n_crt', owner: 'Housten 2009 CRT', beneficiary: 'Charitable remainder', value: 932225, lastUpdated: '2026-08-31', src: 'nw', row: 3 }),
  // Housten Family 1998 Trust (Elaine) — $2,608,515
  acct({ id: 'a_ft_5038', name: 'Schwab Housten Family 1998 Trust', number: '5512-5038', institution: 'Charles Schwab', type: 'Trust', parentId: 'n_1998', owner: 'Housten Family 1998 Trust', beneficiary: 'Per trust terms', value: 1847699, lastUpdated: '2026-08-31', src: 'schwab', row: 9 }),
  acct({ id: 'a_ft_9223', name: 'Schwab Housten Family 1998 Trust', number: '5512-9223', institution: 'Charles Schwab', type: 'Trust', parentId: 'n_1998', owner: 'Housten Family 1998 Trust', beneficiary: 'Per trust terms', value: 130816, lastUpdated: '2026-08-31', src: 'schwab', row: 10 }),
  acct({ id: 'a_vi', name: 'Vi Deposit', number: '', institution: 'Other', type: 'Trust', parentId: 'n_1998', owner: 'Housten Family 1998 Trust', beneficiary: 'Per trust terms', value: 630000, lastUpdated: '2026-09-01', notes: 'Refundable residence entrance deposit.', src: 'manual' }),
  // Family Trust Created under Housten Trust (Sam) — $835,877
  acct({ id: 'a_fam_6427', name: 'Schwab Trust', number: '5512-6427', institution: 'Charles Schwab', type: 'Family Trust', parentId: 'n_fam', owner: 'Family Trust u/Housten Trust (Sam)', beneficiary: 'Elaine Housten (income)', value: 835877, lastUpdated: '2026-08-31', src: 'schwab', row: 11 }),
  // Housten Children's Trust — $337,210 (excluded from estate total)
  acct({ id: 'a_lincoln', name: 'Lincoln VUL', number: '7730-2076', institution: 'Lincoln Financial', type: "Children's Trust", parentId: 'n_child', owner: "Housten Children's Trust", beneficiary: "Housten Children's Trust", value: 337210, lastUpdated: '2026-05-15', notes: 'Death Benefit $3,500,000', src: 'manual' }),
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
    totalValue: 182953 + 0 + 0 + 193197 + 1847699 + 130816 + 835877,
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
    totalValue: 2114747 + 932225,
    unmappedColumns: [],
    importedBy: 'demo@atsestate.com',
  },
];

export const DATA_VERSION = 7;

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
  return d;
}
