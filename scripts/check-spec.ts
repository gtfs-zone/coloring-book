#!/usr/bin/env tsx
/**
 * Checks the hand-written spec in src/gtfs-spec/ against the official GTFS
 * reference snapshot in reference/gtfs-reference.md.
 *
 * Run with: pnpm check-spec
 *   pnpm check-spec agency.txt routes.txt   # restrict to some files
 *   pnpm check-spec --full                  # print the raw reference strings
 *
 * TODO: Phase 2 of FARES_V2_PLAN.md makes this exit zero and wires it into the
 * pre-commit gate. Until then it is informational and is not run by the hooks.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gtfsSpec } from '../src/gtfs-spec/index';
import type { GTFSFieldSpec, GTFSPresence } from '../src/gtfs-spec/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_PATH = join(__dirname, '..', 'reference', 'gtfs-reference.md');

// locations.geojson describes a nested JSON object rather than a CSV table, so
// its "field names" are indentation-encoded and do not map onto GTFSFieldSpec.
const STRUCTURAL_EXCEPTIONS = new Set(['locations.geojson']);

type Aspect =
  | 'file-presence'
  | 'file-description'
  | 'missing-file'
  | 'extra-file'
  | 'missing-field'
  | 'extra-field'
  | 'field-order'
  | 'type'
  | 'presence'
  | 'description';

interface KnownDivergence {
  file: string;
  field?: string;
  aspect: Aspect;
  reason: string;
}

// Deliberate differences from the reference. Every entry needs a reason.
// This list starts empty on purpose: Phase 1 reports drift, it does not excuse it.
const KNOWN_DIVERGENCES: KnownDivergence[] = [];

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Collapses the incidental differences between a reference string and the same
 * string stored in a TS file: backtick markup, whitespace runs, the three <br>
 * spellings, curly quotes and non-breaking spaces. Exported so Phase 2 can
 * reuse the exact same comparison.
 */
export function normalizeSpecText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/ /g, ' ')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRESENCE_VALUES: GTFSPresence[] = [
  'Required',
  'Optional',
  'Conditionally Required',
  'Conditionally Forbidden',
  'Recommended',
];

/**
 * The reference bolds presence values inconsistently (`Optional` is bare in most
 * tables but bold in areas.txt), so bold markers are stripped before matching.
 */
function parsePresence(cell: string): GTFSPresence | null {
  const cleaned = cell
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return PRESENCE_VALUES.find((p) => p.toLowerCase() === cleaned) ?? null;
}

// ─── Reference parsing ────────────────────────────────────────────────────────

interface ReferenceField {
  name: string;
  type: string;
  presence: GTFSPresence | null;
  presenceRaw: string;
  description: string;
}

interface ReferenceFile {
  filename: string;
  presence: GTFSPresence | null;
  /** Description from the "Dataset Files" summary table. */
  summaryDescription: string;
  /** Prose between the `### x.txt` heading and the field table. */
  sectionDescription: string;
  fields: Map<string, ReferenceField>;
  fieldOrder: string[];
  hasFieldTable: boolean;
}

/**
 * Splits a markdown table row. Pipes never appear in the first three columns of
 * a field table, but the description column contains an embedded HTML <table>,
 * so any surplus cells are folded back into the description.
 */
function splitRow(line: string, columns: number): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }
  let body = trimmed.slice(1);
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
  }
  const cells = body.split('|');
  if (cells.length < columns) {
    return null;
  }
  const head = cells.slice(0, columns - 1);
  const tail = cells.slice(columns - 1).join('|');
  return [...head, tail].map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s|:-]+\|?\s*$/.test(line.trim());
}

function stripBackticks(text: string): string {
  return text.replace(/`/g, '').trim();
}

function parseSummaryTable(markdown: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith('## Dataset Files'));
  if (start === -1) {
    throw new Error('Could not find the "Dataset Files" section');
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ') && i > start) {
      break;
    }
    if (isSeparatorRow(line)) {
      continue;
    }
    const cells = splitRow(line, 3);
    if (!cells) {
      continue;
    }
    const nameMatch = cells[0].match(/\[([^\]]+)\]/);
    if (!nameMatch) {
      continue;
    }
    result.set(nameMatch[1].replace(/\\/g, ''), cells[2]);
  }
  return result;
}

function parseReference(markdown: string): Map<string, ReferenceFile> {
  const summaries = parseSummaryTable(markdown);
  const lines = markdown.split('\n');
  const files = new Map<string, ReferenceFile>();

  const headingIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (/^###\s+\S+\.(txt|geojson)\s*$/.test(line)) {
      headingIndexes.push(i);
    }
  });

  for (let h = 0; h < headingIndexes.length; h++) {
    const start = headingIndexes[h];
    const filename = lines[start].replace(/^###\s+/, '').trim();
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]) || /^###\s/.test(lines[i])) {
        end = i;
        break;
      }
    }

    const body = lines.slice(start + 1, end);
    const tableStart = body.findIndex((l) =>
      /^\|\s*Field Name\s*\|/.test(l.trim())
    );

    const proseLines: string[] = [];
    let presence: GTFSPresence | null = null;
    const proseEnd = tableStart === -1 ? body.length : tableStart;
    for (const line of body.slice(0, proseEnd)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const fileMatch = trimmed.match(/^File:\s*(.+)$/i);
      if (fileMatch) {
        presence = parsePresence(fileMatch[1]);
        continue;
      }
      if (/^primary key/i.test(trimmed)) {
        continue;
      }
      proseLines.push(trimmed);
    }

    const fields = new Map<string, ReferenceField>();
    const fieldOrder: string[] = [];
    if (tableStart !== -1) {
      for (let i = tableStart + 1; i < body.length; i++) {
        const line = body[i];
        if (!line.trim().startsWith('|')) {
          break;
        }
        if (isSeparatorRow(line)) {
          continue;
        }
        const cells = splitRow(line, 4);
        if (!cells) {
          continue;
        }
        const name = stripBackticks(cells[0]);
        if (!name) {
          continue;
        }
        fields.set(name, {
          name,
          type: cells[1],
          presence: parsePresence(cells[2]),
          presenceRaw: cells[2],
          description: cells[3],
        });
        fieldOrder.push(name);
      }
    }

    files.set(filename, {
      filename,
      presence,
      summaryDescription: summaries.get(filename) ?? '',
      sectionDescription: proseLines.join(' '),
      fields,
      fieldOrder,
      hasFieldTable: tableStart !== -1,
    });
  }

  return files;
}

// ─── Word-level diff ──────────────────────────────────────────────────────────

type DiffOp = { kind: 'same' | 'del' | 'add'; word: string };

function wordDiff(expected: string, actual: string): DiffOp[] {
  const a = expected.split(' ');
  const b = actual.split(' ');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', word: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'del', word: a[i] });
      i++;
    } else {
      ops.push({ kind: 'add', word: b[j] });
      j++;
    }
  }
  for (; i < a.length; i++) {
    ops.push({ kind: 'del', word: a[i] });
  }
  for (; j < b.length; j++) {
    ops.push({ kind: 'add', word: b[j] });
  }
  return ops;
}

const CONTEXT_WORDS = 5;

/** Renders a word diff as unified hunks. `-` is the reference, `+` is our spec. */
function renderDiff(
  expected: string,
  actual: string,
  indent: string
): string[] {
  const ops = wordDiff(expected, actual);
  const out: string[] = [];
  let cursor = 0;
  while (cursor < ops.length) {
    if (ops[cursor].kind === 'same') {
      cursor++;
      continue;
    }
    let changeEnd = cursor;
    while (changeEnd < ops.length) {
      if (ops[changeEnd].kind !== 'same') {
        changeEnd++;
        continue;
      }
      // A short run of matching words between two edits stays inside the hunk.
      let sameRun = 0;
      while (
        changeEnd + sameRun < ops.length &&
        ops[changeEnd + sameRun].kind === 'same'
      ) {
        sameRun++;
      }
      if (sameRun > CONTEXT_WORDS * 2) {
        break;
      }
      changeEnd += sameRun;
    }
    const before = ops
      .slice(Math.max(0, cursor - CONTEXT_WORDS), cursor)
      .map((o) => o.word)
      .join(' ');
    const after = ops
      .slice(changeEnd, changeEnd + CONTEXT_WORDS)
      .filter((o) => o.kind === 'same')
      .map((o) => o.word)
      .join(' ');
    const hunk = ops.slice(cursor, changeEnd);
    const removed = hunk
      .filter((o) => o.kind !== 'add')
      .map((o) => o.word)
      .join(' ');
    const added = hunk
      .filter((o) => o.kind !== 'del')
      .map((o) => o.word)
      .join(' ');
    const prefix = before ? `...${before} ` : '';
    const suffix = after ? ` ${after}...` : '';
    out.push(`${indent}- ${prefix}${removed}${suffix}`);
    out.push(`${indent}+ ${prefix}${added}${suffix}`);
    cursor = changeEnd;
  }
  return out;
}

// ─── Comparison ───────────────────────────────────────────────────────────────

interface Issue {
  file: string;
  field?: string;
  aspect: Aspect;
  lines: string[];
}

/**
 * The reference writes foreign keys as a compound type string; our spec splits
 * that into `type: 'Foreign ID'` plus a structured `foreignKey`, which is what
 * the adapter and the pickers consume. Reassemble it for comparison.
 */
function expectedTypeString(field: GTFSFieldSpec): string {
  if (field.type === 'Foreign ID' && field.foreignKey) {
    const table = field.foreignKey.file.replace(/\.txt$/, '');
    return `Foreign ID referencing ${table}.${field.foreignKey.field}`;
  }
  return field.type;
}

function isKnown(issue: Issue): boolean {
  return KNOWN_DIVERGENCES.some(
    (d) =>
      d.file === issue.file &&
      d.field === issue.field &&
      d.aspect === issue.aspect
  );
}

function compare(
  reference: Map<string, ReferenceFile>,
  only: Set<string>,
  full: boolean
): Issue[] {
  const issues: Issue[] = [];
  const ourFiles = new Map(gtfsSpec.files.map((f) => [f.filename, f]));

  const wanted = (name: string) => only.size === 0 || only.has(name);

  for (const [filename] of reference) {
    if (!wanted(filename) || STRUCTURAL_EXCEPTIONS.has(filename)) {
      continue;
    }
    if (!ourFiles.has(filename)) {
      issues.push({
        file: filename,
        aspect: 'missing-file',
        lines: ['file is in the reference but not in gtfsSpec'],
      });
    }
  }

  for (const [filename] of ourFiles) {
    if (!wanted(filename) || STRUCTURAL_EXCEPTIONS.has(filename)) {
      continue;
    }
    if (!reference.has(filename)) {
      issues.push({
        file: filename,
        aspect: 'extra-file',
        lines: ['file is in gtfsSpec but not in the reference'],
      });
    }
  }

  for (const [filename, ref] of reference) {
    const ours = ourFiles.get(filename);
    if (!ours || !wanted(filename) || STRUCTURAL_EXCEPTIONS.has(filename)) {
      continue;
    }

    if (ref.presence && ref.presence !== ours.presence) {
      issues.push({
        file: filename,
        aspect: 'file-presence',
        lines: [
          `presence: reference "${ref.presence}", spec "${ours.presence}"`,
        ],
      });
    }

    // The reference states a file's purpose in two places: the Dataset Files
    // summary table and (for some files) prose under the section heading.
    // Either is an acceptable source for our file-level description.
    const candidates = [ref.summaryDescription, ref.sectionDescription]
      .map(normalizeSpecText)
      .filter((c) => c.length > 0);
    const oursDescription = normalizeSpecText(ours.description);
    if (candidates.length > 0 && !candidates.includes(oursDescription)) {
      const lines = [`description matches neither reference wording:`];
      for (const candidate of candidates) {
        lines.push(...renderDiff(candidate, oursDescription, '    '));
      }
      if (full) {
        lines.push(`    raw summary:  ${ref.summaryDescription}`);
        lines.push(`    raw section:  ${ref.sectionDescription}`);
      }
      issues.push({ file: filename, aspect: 'file-description', lines });
    }

    if (!ref.hasFieldTable) {
      continue;
    }

    const ourFields = new Map((ours.fields ?? []).map((f) => [f.name, f]));

    for (const name of ref.fieldOrder) {
      if (ourFields.has(name)) {
        continue;
      }
      const refField = ref.fields.get(name)!;
      issues.push({
        file: filename,
        field: name,
        aspect: 'missing-field',
        lines: [
          `missing field (${refField.type}, ${refField.presence ?? refField.presenceRaw})`,
        ],
      });
    }

    for (const name of ourFields.keys()) {
      if (ref.fields.has(name)) {
        continue;
      }
      issues.push({
        file: filename,
        field: name,
        aspect: 'extra-field',
        lines: ['field is not in the reference'],
      });
    }

    const sharedOurOrder = [...ourFields.keys()].filter((n) =>
      ref.fields.has(n)
    );
    const sharedRefOrder = ref.fieldOrder.filter((n) => ourFields.has(n));
    if (sharedOurOrder.join(',') !== sharedRefOrder.join(',')) {
      issues.push({
        file: filename,
        aspect: 'field-order',
        lines: [
          `reference order: ${sharedRefOrder.join(', ')}`,
          `spec order:      ${sharedOurOrder.join(', ')}`,
        ],
      });
    }

    for (const name of ref.fieldOrder) {
      const refField = ref.fields.get(name)!;
      const ourField = ourFields.get(name);
      if (!ourField) {
        continue;
      }

      const refType = normalizeSpecText(refField.type);
      const ourType = normalizeSpecText(expectedTypeString(ourField));
      if (refType !== ourType) {
        issues.push({
          file: filename,
          field: name,
          aspect: 'type',
          lines: [
            `type: reference "${refField.type}", spec "${expectedTypeString(ourField)}"`,
          ],
        });
      }

      if (refField.presence === null) {
        issues.push({
          file: filename,
          field: name,
          aspect: 'presence',
          lines: [`unparseable reference presence "${refField.presenceRaw}"`],
        });
      } else if (refField.presence !== ourField.presence) {
        issues.push({
          file: filename,
          field: name,
          aspect: 'presence',
          lines: [
            `presence: reference "${refField.presence}", spec "${ourField.presence}"`,
          ],
        });
      }

      const refDescription = normalizeSpecText(refField.description);
      const ourDescription = normalizeSpecText(ourField.description);
      if (refDescription !== ourDescription) {
        const lines = ['description mismatch:'];
        lines.push(...renderDiff(refDescription, ourDescription, '    '));
        if (full) {
          lines.push(`    raw reference: ${refField.description}`);
        }
        issues.push({
          file: filename,
          field: name,
          aspect: 'description',
          lines,
        });
      }
    }
  }

  return issues;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const only = new Set(args.filter((a) => !a.startsWith('--')));

  const markdown = readFileSync(REFERENCE_PATH, 'utf8');
  const reference = parseReference(markdown);

  const all = compare(reference, only, full);
  const issues = all.filter((issue) => !isKnown(issue));
  const excused = all.length - issues.length;

  const byFile = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  console.log(`Reference: ${REFERENCE_PATH}`);
  console.log(
    `Parsed ${reference.size} files from the reference, ${gtfsSpec.files.length} from gtfsSpec (${gtfsSpec.specVersion}).`
  );
  console.log(
    `Skipped by filename: ${[...STRUCTURAL_EXCEPTIONS].join(', ')} (no CSV field table).`
  );
  console.log('');

  const counts = new Map<Aspect, number>();
  for (const [filename, fileIssues] of byFile) {
    console.log(`=== ${filename} ===`);
    for (const issue of fileIssues) {
      counts.set(issue.aspect, (counts.get(issue.aspect) ?? 0) + 1);
      const label = issue.field ? `${issue.field}: ` : '';
      console.log(`  [${issue.aspect}] ${label}${issue.lines[0]}`);
      for (const line of issue.lines.slice(1)) {
        console.log(line);
      }
    }
    console.log('');
  }

  console.log('--- summary ---');
  for (const aspect of [...counts.keys()].sort()) {
    console.log(`  ${aspect}: ${counts.get(aspect)}`);
  }
  console.log(`  files with drift: ${byFile.size}`);
  console.log(`  total differences: ${issues.length}`);
  if (excused > 0) {
    console.log(`  excused by KNOWN_DIVERGENCES: ${excused}`);
  }

  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

main();
