import { inflateRawSync } from "node:zlib";
import { decodeEntities } from "./markdown.ts";
import { fold, tokenize } from "./text.ts";

/** A table of facts: its columns in order, and rows of text by column. */
export interface TableData {
  columns: string[];
  rows: Record<string, string>[];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Parses CSV (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes). The delimiter is
 * a comma, a semicolon or a tab, whichever the header line uses most. The first row names the columns.
 */
export function parseCsv(text: string, delimiter?: string): TableData {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const separator = delimiter ?? [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === separator) {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return fromRecords(records.filter((r) => r.some((value) => value.trim())));
}

/** Rows of cells, the first naming the columns, as a table. Blank or repeated column names get a letter or a number. */
export function fromRecords(records: string[][]): TableData {
  const [header = [], ...body] = records;
  const columns: string[] = [];
  header.forEach((name, i) => {
    let column = name.trim() || columnLetter(i);
    for (let n = 2; columns.includes(column); n++) column = `${name.trim() || columnLetter(i)} ${n}`;
    columns.push(column);
  });
  for (const record of body) {
    for (let i = columns.length; i < record.length; i++) if (record[i]?.trim()) columns.push(columnLetter(i));
  }
  const rows = body.map((record) => Object.fromEntries(columns.map((column, i) => [column, (record[i] ?? "").trim()])));
  return { columns, rows };
}

function columnLetter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** The files in a zip archive, by path. Stored and deflated entries only, which is what spreadsheets use. */
export function unzip(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("it isn't a zip archive (an .xlsx file is one)");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("its zip directory is damaged");
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = data.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(raw)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
/** The text of every <t> in a fragment, leaving out phonetic hints (<rPh>). */
const textRuns = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1]!)).join("");

/** Built-in number formats that show dates and times. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** The style indexes whose number format is a date. */
function dateStyles(styles: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!styles) return dates;
  const custom = new Map<number, string>();
  for (const [tag] of styles.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attribute(tag, "numFmtId")), decodeEntities(attribute(tag, "formatCode") ?? ""));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  [...xfs.matchAll(/<xf\b[^>]*?\/?>/g)].forEach(([tag], index) => {
    const id = Number(attribute(tag, "numFmtId") ?? 0);
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (DATE_FORMATS.has(id) || (code && /[dmyhs]/i.test(code) && !/general/i.test(code))) dates.add(index);
  });
  return dates;
}

/** Excel's day number (days since 1899-12-30) as "2026-10-25", with the time when there is one. */
function excelDate(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86_400_000));
  if (Number.isNaN(date.getTime())) return String(serial);
  const iso = date.toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** The column number of a cell reference: "C7" → 2. */
function columnIndex(reference: string): number {
  let index = 0;
  for (const char of /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? "") index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

/** Reads one sheet of an .xlsx workbook (the first, or the one named) as a table whose first row names the columns. */
export function readXlsx(data: Uint8Array, sheet?: string): TableData {
  const files = unzip(data);
  const text = (path: string) => {
    const file = files.get(path);
    return file ? new TextDecoder().decode(file) : undefined;
  };
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("it isn't an Excel workbook (.xlsx)");
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => ({ name: decodeEntities(attribute(tag, "name") ?? ""), rel: attribute(tag, "r:id") }));
  const chosen = sheet === undefined ? sheets[0] : sheets.find((s) => s.name.toLowerCase() === sheet.toLowerCase());
  if (!chosen) throw new Error(sheet === undefined ? "the workbook has no sheets" : `the workbook has no sheet "${sheet}" (its sheets: ${sheets.map((s) => s.name).join(", ")})`);
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => tag).find((tag) => attribute(tag, "Id") === chosen.rel);
  const href = target ? attribute(target, "Target")! : `worksheets/sheet${sheets.indexOf(chosen) + 1}.xml`;
  const path = href.startsWith("/") ? href.slice(1) : `xl/${href.replace(/^\.\//, "")}`;
  const xml = text(path);
  if (!xml) throw new Error(`the sheet "${chosen.name}" is missing from the workbook`);

  const shared = [...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]!));
  const dates = dateStyles(text("xl/styles.xml"));
  const records: string[][] = [];
  for (const [, rowXml] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const record: string[] = [];
    let next = 0;
    for (const [, tag, body = ""] of rowXml!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = attribute(tag!, "r");
      const index = reference ? columnIndex(reference) : next;
      next = index + 1;
      const type = attribute(tag!, "t");
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let cell = "";
      if (type === "s") cell = shared[Number(value)] ?? "";
      else if (type === "inlineStr") cell = textRuns(body);
      else if (type === "b") cell = value === "1" ? "TRUE" : "FALSE";
      else if (value !== undefined) {
        cell = decodeEntities(value);
        const number = Number(cell);
        if (type !== "str" && type !== "e" && Number.isFinite(number) && dates.has(Number(attribute(tag!, "s") ?? -1))) cell = excelDate(number);
      }
      record[index] = cell;
    }
    records.push(Array.from(record, (cell) => cell ?? ""));
  }
  return fromRecords(records.filter((r) => r.some((value) => value.trim())));
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface Condition {
  /** A column, or ANY_COLUMN to match the value in whichever column has it. */
  column: string;
  /** A value, or a comparison with a number: ">= 40", "< 100". */
  value: string;
}

export const ANY_COLUMN = "\u0000any";

/** Folded, with punctuation as spaces: "X-100 " and "x 100" are the same part. */
const loose = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const compact = (text: string) => loose(text).replace(/ /g, "");

/** The column a name means: exactly, else ignoring case, spaces and punctuation. */
export function findColumn(columns: readonly string[], name: string): string | undefined {
  return columns.find((column) => column === name) ?? columns.find((column) => compact(column) === compact(name));
}

/** How well a cell matches a value: 3 exactly, 2 as one item of a list, 1 as words inside it, 0 not at all. */
export function cellMatch(cell: string, value: string): number {
  const comparison = /^\s*(<=|>=|<|>|=)\s*(-?[\d.,]+)\s*$/.exec(value);
  if (comparison) {
    const number = parseFloat(cell.replace(/[^\d.-]/g, ""));
    const limit = parseFloat(comparison[2]!.replace(/,/g, ""));
    if (!Number.isFinite(number)) return 0;
    const ok = { "<=": number <= limit, ">=": number >= limit, "<": number < limit, ">": number > limit, "=": number === limit }[comparison[1] as "<"];
    return ok ? 3 : 0;
  }
  const wanted = loose(value);
  if (!wanted) return 0;
  if (loose(cell) === wanted || compact(cell) === compact(value)) return 3;
  if (cell.split(/[,;/|\n]/).some((item) => loose(item) === wanted)) return 2;
  return ` ${loose(cell)} `.includes(` ${wanted} `) ? 1 : 0;
}

/** Rows that match every condition and, with `query`, contain its words; the closest matches first. */
export function lookupRows(table: TableData, conditions: readonly Condition[], query?: string): Record<string, string>[] {
  const queryTerms = query ? new Set(tokenize(query)) : undefined;
  return table.rows
    .map((row, index) => {
      let score = 0;
      for (const { column, value } of conditions) {
        const match = column === ANY_COLUMN ? Math.max(0, ...table.columns.map((c) => cellMatch(row[c] ?? "", value))) : cellMatch(row[column] ?? "", value);
        if (!match) return undefined;
        score += match;
      }
      if (queryTerms?.size) {
        const rowTerms = new Set(tokenize(Object.values(row).join(" ")));
        const found = [...queryTerms].filter((term) => rowTerms.has(term)).length;
        if (!found) return undefined;
        score += found / queryTerms.size;
      }
      return { row, score, index };
    })
    .filter((entry) => entry !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ row }) => row);
}

/** Values of a column that share a word with the one asked for, for "no row has X; did you mean…". */
export function similarValues(table: TableData, column: string, value: string, limit = 8): string[] {
  const wanted = new Set(tokenize(value));
  const values = new Map<string, number>();
  for (const row of table.rows) {
    for (const item of (row[column] ?? "").split(/[,;/|\n]/).map((v) => v.trim()).filter(Boolean)) {
      const shared = tokenize(item).filter((term) => wanted.has(term)).length;
      if (shared) values.set(item, Math.max(values.get(item) ?? 0, shared));
    }
  }
  return [...values].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([item]) => item);
}

/** A row as one line for the model: "Part: FP-2 · Fits: Ridgeline 2P Tent". Empty cells are left out. */
export function rowLine(row: Record<string, string>, columns: readonly string[]): string {
  return columns
    .filter((column) => row[column])
    .map((column) => `${column}: ${row[column]!.replace(/\s+/g, " ")}`)
    .join(" · ");
}
