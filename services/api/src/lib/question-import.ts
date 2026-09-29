import { readSheet } from 'read-excel-file/node';
import { HttpError } from './http';
import { parseQuestionInput, type ParsedQuestion } from './questions';

/**
 * Reading questions out of a file somebody made elsewhere.
 *
 * A course already exists in a spreadsheet somewhere — an old quiz, a question
 * bank, a list a colleague wrote — and asking for it to be retyped into a form
 * one question at a time is asking for it to be abandoned instead. Two formats
 * are read:
 *
 * - **`.xlsx`** — the format a spreadsheet actually is. Legacy `.xls` is not
 *   read: it is a different file format entirely (a binary one), and the only
 *   sane advice for it is "save it as .xlsx", which the refusal says.
 * - **`.csv`** — the same sheet, as text, which is what a spreadsheet exports
 *   when somebody's tool will not write `.xlsx`.
 * - **`.json`** — what this API hands out, and what a script generates.
 *
 * Three rules hold for all of them, and they are the reason this file exists
 * rather than three parsers:
 *
 * 1. **A row that cannot be read is reported, not thrown.** A file of fifty
 *    questions with one malformed row imports forty-nine and says which row was
 *    not; a request that failed entirely would leave the author to find the
 *    problem by hand.
 * 2. **Every question goes through the same validator as a typed one**
 *    (`parseQuestionInput`), so an imported question cannot be a shape the
 *    create route would have refused.
 * 3. **Nothing is imported as verified.** The status is the route's business,
 *    and it is `NEEDS_VERIFICATION` for exactly the reason a generated question
 *    is: nobody in this building has read this row.
 */

/**
 * How much one import may carry.
 *
 * Not a technical limit — a spreadsheet of ten thousand rows would parse — but
 * a review limit: every imported question arrives needing to be read by a
 * person, and an import that lands a thousand of them is a review queue nobody
 * finishes. Batches are fine; batches are how a question bank gets in.
 */
export const MAX_IMPORT_ROWS = 300;

/** The largest file worth decoding, well inside API Gateway's request limit. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** One row of a file, as it was read and what became of it. */
export interface ImportedRow {
  /** 1-based line in the file, so an error can be pointed at. */
  row: number;
  question?: ParsedQuestion;
  error?: string;
}

export interface ImportOutcome {
  rows: ImportedRow[];
  /** Rows the file held, read and rejected together. */
  total: number;
}

/**
 * A file, as the route received it.
 *
 * No lesson: which lesson the questions are about is a fact about the *request*
 * rather than about the file, and the route stamps every row it writes with it.
 * See `import-questions`, where "one file, one lesson" is written down.
 */
export interface ImportFile {
  fileName: string;
  contentBase64: string;
}

/**
 * The canonical fields of one question, whatever shape the file had.
 *
 * Everything the parsers do is a mapping into this, which is what keeps "what a
 * row means" in one place: a spreadsheet's columns and a JSON object's keys are
 * two spellings of the same six fields, and once they are here the rest of the
 * path — validation, option ids, the answer — knows nothing about files.
 */
interface QuestionRecord {
  type?: unknown;
  prompt?: unknown;
  /** The option texts in the order they were given. */
  options: string[];
  answer?: unknown;
  explanation?: unknown;
}

/** Column headings that mean each canonical field, lower-cased and stripped. */
const TYPE_HEADERS = ['type', 'kind', 'question type', 'questiontype'];
const PROMPT_HEADERS = ['question', 'prompt', 'text', 'statement', 'question text'];
const ANSWER_HEADERS = [
  'answer',
  'correct',
  'correct answer',
  'correctanswer',
  'correct option',
  'correctoption',
  'right answer',
  'rightanswer',
  'answer key',
  'key',
];
const EXPLANATION_HEADERS = ['explanation', 'rationale', 'why', 'feedback', 'note', 'notes'];

/** Option columns, by the letter they carry: `option a`, `a`, `choice a`, `answer a`. */
const OPTION_HEADER_PATTERN =
  /^(?:option|choice|answer|opt)?[\s._-]*([a-f])\)?[.:]?$/i;

/** A header as it is compared: lower case, collapsed, without punctuation noise. */
function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[*:]+$/, '');
}

/**
 * Which letter of the alphabet a column is: `Option B` and `b` are the same
 * column, and `Explanation` is not an option despite containing an `a`.
 */
function optionIndexOfHeader(header: string): number | undefined {
  const cleaned = header.replace(/[()]/g, '');
  const match = cleaned.match(OPTION_HEADER_PATTERN);
  if (!match) return undefined;
  return match[1].toLowerCase().charCodeAt(0) - 97;
}

/** The first column whose heading means one of these names. */
function findColumn(headers: string[], names: string[]): number | undefined {
  const index = headers.findIndex((header) => names.includes(header));
  return index === -1 ? undefined : index;
}

/**
 * A cell as a question field.
 *
 * Spreadsheets do not have a string type: an answer written as `True` arrives as
 * a boolean, one written as `1` as a number, and a prompt that looks like a date
 * as a `Date`. Each is turned back into the value a person meant, which is what
 * keeps a true/false row whose answer cell is a real boolean from being read as
 * the string "true" and refused.
 */
function cellValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw;

  // An empty cell is a cell nobody filled in, not the empty string: a row whose
  // type column is blank is a row whose type is inferred, and one whose
  // explanation is blank is a question with no explanation rather than one with
  // an empty one.
  const text = String(raw).trim();
  return text === '' ? undefined : text;
}

/** Whether every cell of a row is empty — a spacer row, not a question. */
function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');
}

/**
 * One row of a sheet, read by its column headings.
 *
 * The type is inferred when the file does not say: a row with option columns
 * filled in is a multiple-choice question, and one without them is true/false.
 * That inference is what lets a plain two-column sheet — question, answer —
 * import without a type column at all, which is how most of these spreadsheets
 * are actually written.
 */
function recordFromCells(headers: string[], cells: unknown[]): QuestionRecord {
  const at = (index: number | undefined) => (index === undefined ? undefined : cellValue(cells[index]));

  const options: string[] = [];
  for (const [index, header] of headers.entries()) {
    const optionIndex = optionIndexOfHeader(header);
    if (optionIndex === undefined) continue;
    const text = cellValue(cells[index]);
    if (typeof text === 'string' && text) options[optionIndex] = text;
    else if (typeof text === 'number') options[optionIndex] = String(text);
  }

  const typeColumn = findColumn(headers, TYPE_HEADERS);
  const declared = at(typeColumn);

  // Whatever the file calls it, a question whose options are filled in is a
  // multiple-choice question: reading it as true/false because the type cell was
  // empty would throw away the options it came with.
  const filled = options.filter(Boolean);

  return {
    type: declared ?? (filled.length > 0 ? 'MULTIPLE_CHOICE' : 'TRUE_FALSE'),
    prompt: at(findColumn(headers, PROMPT_HEADERS)),
    options: filled.length > 0 ? compactOptions(options) : [],
    answer: at(findColumn(headers, ANSWER_HEADERS)),
    explanation: at(findColumn(headers, EXPLANATION_HEADERS)),
  };
}

/**
 * The option texts with their gaps closed.
 *
 * A sheet with `Option A`, `Option B` and `Option D` filled in and a blank `C`
 * is a question with three options, not one with a hole in the middle — and the
 * answer column names them by letter, which is read against the options that
 * survived.
 */
function compactOptions(options: string[]): string[] {
  return options.filter((text) => text !== undefined && text !== null && text !== '');
}

/** One JSON entry, read by its keys, with the aliases a hand-written file uses. */
function recordFromJsonObject(entry: Record<string, unknown>): QuestionRecord {
  const pick = (names: string[]): unknown => {
    for (const [key, value] of Object.entries(entry)) {
      if (names.includes(normalizeHeader(key)) && value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return undefined;
  };

  const rawOptions = pick(['options', 'choices', 'answers', 'option']);
  const options: string[] = [];

  if (Array.isArray(rawOptions)) {
    for (const option of rawOptions) {
      if (typeof option === 'string' || typeof option === 'number') options.push(String(option));
      else if (option && typeof option === 'object' && typeof (option as { text?: unknown }).text === 'string') {
        options.push((option as { text: string }).text);
      }
    }
  }

  // `optionA`…`optionF`, and `answer_a`, are the same columns a sheet has.
  for (let letter = 0; letter < 6; letter += 1) {
    const key = String.fromCharCode(97 + letter);
    const value = pick([`option${key}`, `option ${key}`, `choice${key}`, `choice ${key}`, `answer${key}`]);
    if (typeof value === 'string' || typeof value === 'number') options[letter] = String(value);
  }

  const declared = pick(TYPE_HEADERS);

  return {
    type: declared ?? (compactOptions(options).length > 0 ? 'MULTIPLE_CHOICE' : 'TRUE_FALSE'),
    prompt: pick(PROMPT_HEADERS),
    options: compactOptions(options),
    answer: pick(ANSWER_HEADERS),
    explanation: pick(EXPLANATION_HEADERS),
  };
}

/** A record through the one validator, as a row result. */
function toRow(row: number, record: QuestionRecord): ImportedRow {
  const parsed = parseQuestionInput({
    type: record.type,
    prompt: record.prompt,
    options: record.options.length > 0 ? record.options : undefined,
    answer: record.answer,
    explanation: record.explanation,
  });

  if ('error' in parsed) return { row, error: parsed.error };

  return { row, question: parsed.question };
}

/**
 * A CSV file as rows of cells.
 *
 * Written out rather than pulled in, because the format is forty lines of
 * specification and every parser of it is one dependency more inside a Lambda:
 * quoted fields, doubled quotes inside them, commas and newlines inside quotes,
 * and CRLF. What it does *not* do is guess a delimiter — a file that uses tabs
 * or semicolons says so by having no commas in its header, which is checked
 * before this runs.
 */
function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      // A CRLF is one line ending, not two.
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

/** The delimiter a delimited file actually uses, judged by its first line. */
function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[string, number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
  ];
  const [delimiter, count] = counts.sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? delimiter : ',';
}

/** The decoded bytes of an uploaded file, or the reason there are none. */
function decode(file: ImportFile): Buffer {
  const cleaned = file.contentBase64.includes(',')
    ? file.contentBase64.slice(file.contentBase64.indexOf(',') + 1)
    : file.contentBase64;

  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) throw new HttpError(400, 'The file is empty');
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw new HttpError(413, `The file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB`);
  }
  return buffer;
}

/** What a file is, by its name. The extension is the only thing a browser sends. */
function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Reads a whole file into rows of questions.
 *
 * A file-level failure — the wrong kind of file, one that cannot be parsed at
 * all, one with more rows than an import may carry — is thrown, because there is
 * nothing partial to report: no rows were read. Once there are rows, every
 * failure after that is per row.
 */
export async function parseImportFile(file: ImportFile): Promise<ImportOutcome> {
  const extension = extensionOf(file.fileName);
  const buffer = decode(file);

  if (extension === 'xls') {
    throw new HttpError(
      400,
      'Legacy .xls files are not read — save the sheet as .xlsx or .csv and import that',
    );
  }

  if (extension === 'json') {
    return fromJson(buffer.toString('utf8'));
  }
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const text = buffer.toString('utf8');
    return fromTable(parseDelimited(text, sniffDelimiter(text)));
  }
  if (extension === 'xlsx') {
    return fromTable(await readSheetRows(buffer));
  }

  throw new HttpError(
    400,
    `Unsupported file type "${extension || file.fileName}" — import .xlsx, .csv or .json`,
  );
}

/**
 * The cells of a workbook's first sheet.
 *
 * The first sheet rather than a named one: a file made for this import has one
 * sheet, and a file with several is a question bank whose tabs somebody will ask
 * about later — importing the first is the answer that never surprises anybody.
 */
async function readSheetRows(buffer: Buffer): Promise<unknown[][]> {
  try {
    return (await readSheet(buffer, 1)) as unknown[][];
  } catch (err) {
    throw new HttpError(
      400,
      `Could not read that spreadsheet (${err instanceof Error ? err.message : 'unknown error'})`,
    );
  }
}

/** A sheet — or a delimited file — as questions, by its heading row. */
function fromTable(rows: unknown[][]): ImportOutcome {
  // The heading row is the first row that looks like one: a sheet somebody
  // pasted into often has a title above its columns, and a parser that assumed
  // row 1 would read the title as a column name and every question as garbage.
  const headerIndex = rows.findIndex(
    (row) => !isBlankRow(row) && row.filter((cell) => String(cell ?? '').trim() !== '').length >= 2,
  );

  if (headerIndex === -1) throw new HttpError(400, 'The file has no rows to read');

  const headers = rows[headerIndex].map(normalizeHeader);
  const body = rows.slice(headerIndex + 1);

  if (body.filter((row) => !isBlankRow(row)).length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      400,
      `The file holds more than ${MAX_IMPORT_ROWS} questions — import it in batches`,
    );
  }

  const imported: ImportedRow[] = [];
  for (const [index, cells] of body.entries()) {
    if (isBlankRow(cells)) continue;
    // 1-based, counting the file as a spreadsheet does: the heading is row 1.
    imported.push(toRow(headerIndex + index + 2, recordFromCells(headers, cells)));
  }

  if (imported.length === 0) throw new HttpError(400, 'The file has no questions in it');
  return { rows: imported, total: imported.length };
}

/** A JSON file as questions: an array, or an object with a `questions` array. */
function fromJson(text: string): ImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new HttpError(
      400,
      `That file is not valid JSON (${err instanceof Error ? err.message : 'unknown error'})`,
    );
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown }).questions)
      ? ((parsed as { questions: unknown[] }).questions)
      : null;

  if (!entries) {
    throw new HttpError(
      400,
      'A JSON import is a list of questions, or an object with a "questions" list',
    );
  }
  if (entries.length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      400,
      `The file holds more than ${MAX_IMPORT_ROWS} questions — import it in batches`,
    );
  }

  const rows: ImportedRow[] = entries.map((entry, index) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? toRow(index + 1, recordFromJsonObject(entry as Record<string, unknown>))
      : { row: index + 1, error: 'each question must be an object' },
  );

  if (rows.length === 0) throw new HttpError(400, 'The file has no questions in it');
  return { rows, total: rows.length };
}

/**
 * The CSV a person starts from.
 *
 * Generated here rather than shipped as a file in the repository, because the
 * headings on it are the contract `recordFromCells` reads: a template that
 * drifted from the parser would be a template that produces imports which fail.
 * `answer` is a letter, which is the one spelling of it that cannot be misread.
 */
export function importTemplateCsv(): string {
  const header = 'Type,Question,Option A,Option B,Option C,Option D,Answer,Explanation';
  const rows = [
    [
      'MULTIPLE_CHOICE',
      'What does a 180-degree shutter angle do to motion blur?',
      'Increases it',
      'Removes it',
      'Doubles it',
      '',
      'A',
      'A wider shutter angle lets light in for longer, so a moving subject blurs further across each frame.',
    ],
    [
      'TRUE_FALSE',
      'A 180-degree shutter angle is the cinematic standard.',
      '',
      '',
      '',
      '',
      'True',
      'It reproduces the motion blur a projector shows at 24 frames per second.',
    ],
  ];

  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [header, ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n';
}
