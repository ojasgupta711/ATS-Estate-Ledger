// Core domain model for ATS Estate Ledger.

export const DEFAULT_ACCOUNT_TYPES = [
  'Qualified',
  'Minor',
  'CRT',
  'Trust',
  'Family Trust',
  "Children's Trust",
  'Sub-Trust',
  'Individual',
  'Joint',
  'Other',
] as const;

/** Account types are strings so users can add their own later. */
export type AccountType = string;

/** Estate categories / trusts use the same type vocabulary plus "Category". */
export const NODE_TYPES = [
  'Category',
  'Qualified',
  'Minor',
  'CRT',
  'Trust',
  'Family Trust',
  "Children's Trust",
  'Sub-Trust',
  'Other',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const FREQUENCIES = ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'One-Time', 'As Needed'] as const;
export type Frequency = (typeof FREQUENCIES)[number] | '';

export interface ValueHistoryEntry {
  date: string; // ISO timestamp of the change
  value: number | null;
  source: string; // e.g. "Manual edit" or "Schwab September 2026.xlsx"
}

export interface AccountSource {
  kind: 'manual' | 'import';
  fileName?: string;
  importId?: string;
  importedAt?: string; // ISO
  institution?: string;
  sheet?: string;
  row?: number; // 1-based spreadsheet row the value came from
  fileUrl?: string; // link to the original file saved by the server
}

export interface Account {
  id: string;
  clientId: string;
  name: string;
  number: string;
  institution: string;
  type: AccountType;
  parentId: string | null; // EstateNode id; null = directly under the estate
  owner: string;
  beneficiary: string;
  value: number | null; // current market value / FMV
  distributionAmount: number | null;
  distributionFrequency: Frequency;
  lastUpdated: string; // ISO date (yyyy-mm-dd)
  notes: string;
  /** Shown in reports but not counted in the estate total (e.g. life-insurance cash value). */
  excludeFromTotal: boolean;
  source: AccountSource;
  history: ValueHistoryEntry[];
  createdAt: string;
}

/** A trust or estate category. Can contain accounts and other nodes. */
export interface EstateNode {
  id: string;
  clientId: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  distributionInfo: string;
  notes: string;
  order: number;
  /** Header color used on-screen and in the PDF (key of NODE_COLORS). */
  color: NodeColor;
  /** Everything under this node is shown but excluded from the estate total. */
  excludeFromTotal: boolean;
  /** Preferred PDF column for top-level sections. */
  reportColumn: 'auto' | 'left' | 'right';
  /** Optional charitable-remainder-trust payout schedule. */
  crt?: CrtSchedule;
}

export interface CrtScheduleRow {
  year: number;
  fmv: number | null;
  distribution: number | null;
}

export interface CrtSchedule {
  initialDate: string; // ISO date the trust was funded
  initialValue: number | null;
  netProceeds: number | null;
  payoutRate: number | null; // percent, e.g. 8 = 8.00%
  fmvAsOfDate: string;
  fmvAsOf: number | null;
  rows: CrtScheduleRow[];
}

export const NODE_COLORS = {
  peach: { label: 'Peach', hex: '#f6d9ab', dark: '#8a5a1c' },
  gold: { label: 'Gold', hex: '#f1c86a', dark: '#8a6412' },
  slate: { label: 'Slate', hex: '#c9d1e3', dark: '#3d4b6b' },
  sage: { label: 'Sage', hex: '#a9d0a3', dark: '#2f6a2a' },
  green: { label: 'Green', hex: '#a3c97f', dark: '#47701f' },
  lavender: { label: 'Lavender', hex: '#cdb8e2', dark: '#5d3d85' },
  blue: { label: 'Blue', hex: '#93b3dd', dark: '#244f86' },
  rose: { label: 'Rose', hex: '#efbcb8', dark: '#8b3a33' },
} as const;
export type NodeColor = keyof typeof NODE_COLORS;

export interface Client {
  id: string;
  name: string; // e.g. "Jane Doe"
  estateName: string; // e.g. "Jane Doe Estate"
  advisor: string;
  notes: string;
  createdAt: string;
}

/** A file saved by the local server under storage/clients/<client>/... */
export interface StoredFile {
  path: string; // relative to the storage folder, e.g. "clients/Jane Doe Estate/uploads/2026-09/..."
  url: string; // "/api/files/..."
  size: number;
  sha256: string;
  savedAt: string;
}

export interface ImportRecord {
  id: string;
  clientId: string;
  fileName: string;
  institution: string;
  importedAt: string;
  accountsAdded: number;
  accountsReplaced: number;
  accountsSkipped: number;
  totalValue: number; // value of rows added or replaced
  unmappedColumns: string[];
  importedBy: string;
  institutions?: string[]; // every institution found in the file
  sheets?: string[];
  storedFile?: StoredFile; // original file, when saved by the server
}

/** Saved column mapping per institution so repeat imports are one click. */
export interface MappingTemplate {
  institution: string;
  headers: string[];
  mapping: Partial<Record<ImportField, string>>;
}

export type ImportField =
  | 'name'
  | 'number'
  | 'institution'
  | 'type'
  | 'owner'
  | 'beneficiary'
  | 'parent'
  | 'value'
  | 'distributionAmount'
  | 'distributionFrequency'
  | 'lastUpdated'
  | 'notes';

export interface AppData {
  version: number;
  clients: Client[];
  nodes: EstateNode[];
  accounts: Account[];
  imports: ImportRecord[];
  accountTypes: string[];
  institutions: string[];
  mappingTemplates: MappingTemplate[];
  settings: ReportSettings;
  /** Everything people have done to each client, newest first. */
  activity: ActivityEntry[];
}

export type ActivityKind =
  | 'client-added'
  | 'client-updated'
  | 'account-added'
  | 'account-updated'
  | 'account-deleted'
  | 'trust-added'
  | 'trust-updated'
  | 'trust-deleted'
  | 'import'
  | 'report';

export interface ActivityChange {
  field: string;
  before: string;
  after: string;
}

export interface ActivityEntry {
  id: string;
  clientId: string;
  at: string; // ISO timestamp
  user: { name: string; email: string };
  kind: ActivityKind;
  summary: string;
  targetId?: string; // account or trust id
  importId?: string;
  changes?: ActivityChange[];
}

export interface ReportSettings {
  firmName: string; // "ATS"
  firmTagline: string; // "Advanced Trustee Strategies"
  logoDataUrl: string | null; // optional uploaded logo (PNG/JPG)
  internalUseLabel: boolean;
}
