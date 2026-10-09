# ATS Estate Ledger

A financial asset and estate management portal for Advanced Trustee Strategies.
It replaces retyping values from Schwab, Nationwide and other custodian reports into
an estate summary. You import the spreadsheet, map the columns, review duplicates,
and then generate the client-ready **Estate Summary PDF**.

> **Version 0.4.** The app runs in the browser and talks to a small local server that
> saves all data, uploaded spreadsheets and generated PDFs in this project's `storage/`
> folder. Login, email verification and Google sign-in are still simulated; real
> authentication and a hosted database come in the next phase (see the roadmap below).

## Run it on your computer (Windows)

### One-time setup

1. Install **Node.js 20 or newer** (the LTS version) from <https://nodejs.org>.
   Accept the defaults in the installer.
2. Open **PowerShell** or **Command Prompt** in the project folder. In File Explorer, open
   `C:\Users\Ojas\projects\ATS Estate Ledger`, click the address bar, type `powershell`
   and press Enter.
3. Install the dependencies (takes a minute; only needed once, and again if
   `package.json` changes):

   ```
   npm install
   ```

### Start the client and the server together (recommended)

```
npm run dev
```

This starts two things in the same window:

| | Address | What it does |
| --- | --- | --- |
| **server** | <http://localhost:3001> | Saves data and files in `storage/` (`server/index.mjs`) |
| **client** | <http://localhost:5173> | The app itself, with live reload (Vite) |

Open **<http://localhost:5173>** in Chrome or Edge. The page footer should say
**"Saved to C:\Users\Ojas\projects\ATS Estate Ledger\storage"**. If it says *"Server not
running"*, the server didn't start; check the `[server]` lines in the terminal.

Press **Ctrl + C** in the terminal to stop both.

### Or run them in two separate terminals

```
npm run server      (terminal 1: http://localhost:3001)
npm run client      (terminal 2: http://localhost:5173)
```

### Run it the way it will run in production

```
npm start
```

This builds the app and serves it from the server alone at **<http://localhost:3001>**.

**Demo login:** `demo@atsestate.com` / `Demo1234!`. You can also click **Use demo login**.
You can create your own login too: the verification code is shown on screen, because
email sending isn't connected yet. To restore the Jane Doe sample data, go to
**Settings → Reset demo data**.

## Where files are stored

Everything is saved under the `storage/` folder in the project, organized by client:

```
storage/
├─ data/
│  ├─ app-data.json                     all clients, trusts, accounts and import history
│  └─ backups/app-data-<date_time>.json the 30 previous versions, saved automatically
└─ clients/
   └─ Jane Doe Estate/
      ├─ uploads/
      │  └─ 2026-09/
      │     └─ 2026-09-27_101530__Schwab September 2026.xlsx   original spreadsheet, never overwritten
      └─ reports/
         └─ Jane Doe Estate Summary 2026-09-27.pdf       generated estate summaries
```

- Every imported spreadsheet is kept exactly as uploaded, with a time stamp in its
  name. Each account links back to its original file ("Open the original spreadsheet"
  on the account page), and so does each entry in Import History.
- Generating the PDF saves it in the client's `reports` folder. Generating it again on
  the same day replaces that day's file. The PDF page lists saved reports with
  **Open** and **Download** links.
- To use a different location (for example a shared drive), set `ATS_STORAGE_DIR`
  before starting: `set ATS_STORAGE_DIR=D:\ATS Storage` then `npm run dev`
  (Command Prompt), or `$env:ATS_STORAGE_DIR="D:\ATS Storage"; npm run dev` (PowerShell).
- **Back up `storage/`.** It holds client financial data. It is excluded from git
  (`.gitignore`), so it never ends up in a repository.
- If the server isn't running, the app still works, but data stays in the browser
  only and files are not saved to disk.

## Changes / Import History (audit trail)

Every change to a client is recorded with **who** made it and the **date and time**:
accounts added, edited, moved or deleted; trusts and categories added, edited or deleted;
Excel imports; client changes; and generated PDFs. Edits show each field's value before
and after, and imports list every account they added or updated.

- The **Changes/Import History** tab shows the full log, grouped by day. You can filter by
  type of change or by person, and search it.
- The **Overview** page shows the five most recent changes.
- The log is stored with the rest of the data in `storage/data/app-data.json`.

## Several people at once

When several people use the app through the same server, each browser checks for other
people's saved changes every few seconds and folds them in. If two people save at the same
moment, the changes are merged record by record, so nothing is overwritten silently. If both
people edited the *same* account or trust, the version saved first is kept and a notice at the
top of the page says what to double-check.

To let colleagues on the office network use your copy, the server has to accept connections
from other computers. It currently listens only on this computer (`127.0.0.1`); ask before
opening it up, since the data is sensitive and login is still simulated.

## Estate Summary PDF

- **Generate Estate Summary PDF** (PDF Report tab) builds the report and opens it in a
  **review window** every time, so you can check it before downloading. The pages are
  drawn with PDF.js, so the preview works even when the browser is set to download PDFs
  instead of showing them. Close the window and use **Review PDF** to see it again.
- Accounts that aren't in a trust are still included: they appear in an **Other
  Accounts** section and count toward the total.
- **Children's Trusts are always left out of the estate total.** They still appear on the
  report, marked "shown for reference". This applies to any trust of type *Children's
  Trust*, everything under it, and any account with the type *Children's Trust*.

## Importing files with several institutions

A single spreadsheet can include accounts from many custodians and carriers. The import
works out each row's institution in this order:

1. **An institution column.** "Carrier", "Custodian", "Institution", "Company" or
   "Issuer" is mapped automatically. Names like *Jackson National Life*, *Equitable*,
   *PacLife*, *Midland National* or *AIG Life* are matched to your list (Jackson,
   AXA (Equitable), Pacific Life, Sammons, Corebridge).
2. **Section headings.** A row that only says "Pacific Life" applies to the rows below
   it, up to the next heading.
3. **Sheet names.** A workbook with one sheet per carrier ("John Hancock", "AXA", …).
   Sheets with the same columns can be imported together in one pass.
4. **The default institution** picked for the file, if any.

The review step shows a count and total for each institution, and you can change any
row's institution before importing. Try it with the sample **Housten Annuity Summary
Q3 2026.xlsx** (eight carriers).

The institution list is managed in **Settings → Financial institutions**.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project**, then import the repository.
3. Vercel detects **Vite** automatically. Everything is set in `vercel.json`: the build
   command is `npm run build` and the output folder is `dist`.
4. `api/health.ts` is a placeholder serverless function (`/api/health`). On Vercel the
   local file server doesn't run, so the app falls back to browser storage. Hosted
   storage (database + Vercel Blob for files) is the next phase.

## What's included

| Area | Where |
| --- | --- |
| Login / create account / email verification / Google sign-in (simulated) | `src/pages/auth/AuthPages.tsx`, `src/state/auth.tsx` |
| Client list and new-client flow | `src/pages/Clients.tsx` |
| Dashboard: all widgets on one page | `src/pages/Dashboard.tsx` |
| Estate summary, account-type breakdown, hierarchy tree | `src/pages/EstatePages.tsx` |
| Accounts list, account detail, manual add/edit | `src/pages/AccountPages.tsx`, `src/components/AccountForm.tsx`, `src/components/AccountsTable.tsx` |
| Trusts: view/edit, sub-trusts, CRT payout schedule | `src/pages/TrustPages.tsx` |
| Excel/CSV import wizard | `src/pages/ImportWizard.tsx`, `src/lib/importPlan.ts`, `src/lib/mapping.ts` |
| Spreadsheet reader (.xlsx and .csv, no dependencies) | `src/lib/spreadsheet.ts` |
| Duplicate detection | `src/lib/duplicates.ts` |
| Data-quality checks | `src/lib/quality.ts` |
| All totals and roll-ups | `src/lib/calc.ts` |
| Estate Summary PDF | `src/lib/pdf.ts`, `src/pages/ReportPage.tsx` |
| Sample data (Jane Doe, fictional) | `src/data/seed.ts` |
| Local server (data + file storage) | `server/index.mjs`, `src/lib/api.ts` |
| Dev runner (client + server together) | `scripts/dev.mjs` |
| Institution list and name matching | `src/data/institutions.ts` |
| Sample import files | `public/samples/` |

**Stack:** React 19, TypeScript, Tailwind CSS v4, Vite 6, the
[Lucide](https://lucide.dev) icon set (through `react-icons/lu`) and `pdf-lib`.
Light, dark and system themes are supported.

## How the accuracy rules are enforced

- **Totals are never stored.** Every total (estate, trust, type, institution and
  distributions) is recalculated from the account values on every screen, so totals
  can't drift. The Summary page shows a *Totals reconcile* check.
- **Nothing is silently overwritten.** Duplicate matches must be resolved before an
  import can be confirmed: *Keep existing*, *Replace existing*, *Create new*, or
  *Review differences* first.
- **Value changes need confirmation.** Editing a value asks for confirmation, and every
  value change is kept in the account's value history.
- **Deletes need confirmation.** Deleting a trust never deletes its accounts; they move
  up to the parent trust.
- **Every value has a source.** Imported accounts record the file name, sheet, row,
  institution and import date.
- **Some accounts can be excluded from the total.** An account or trust can be kept on
  the report but left out of the estate total (for example, a VUL cash value). This is
  how the $337,210 Children's Trust is kept out of the $6,867,514 total, matching the
  original worksheet.

## Roadmap (next phase)

1. **Database:** Postgres (Vercel Postgres/Neon) with tables for clients, trusts,
   accounts, value history, imports and mapping templates, replacing `app-data.json`.
2. **Authentication:** Auth.js (NextAuth) or Clerk, with email + password, emailed
   verification codes and real Google OAuth.
3. **Hosted file storage:** move `storage/` to Vercel Blob (or S3) when the app is hosted.
4. **Roles and audit log:** who changed what, and when.
5. **Custodian integrations:** Schwab and Nationwide data feeds, where available.
