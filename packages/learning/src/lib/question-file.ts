import { downloadTextFile } from './question-export';

/**
 * Reading a file somebody picked, and the template they start from.
 *
 * The file travels to the API base64 inside a JSON body — API Gateway's REST
 * integration has no multipart parser — so what this has to get right is turning
 * a `File` into that string without holding two copies of it in memory, and
 * without the data-URL prefix that `FileReader` puts in front of one.
 */

/** How large a file the import accepts, mirroring the API's own ceiling. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** The extensions the import reads. The API decides the rest, by the same names. */
export const IMPORT_EXTENSIONS = ['.xlsx', '.csv', '.tsv', '.json'];

export async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

/**
 * Base64 of some bytes, in chunks.
 *
 * `String.fromCharCode(...new Uint8Array(buffer))` is the one-liner and it
 * throws on anything past a few hundred kilobytes: spreading a large array into
 * a call is an argument list, and there is a limit on how long one may be. A
 * spreadsheet of questions passes that limit immediately.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }

  return btoa(binary);
}

/**
 * The spreadsheet an author starts from.
 *
 * A CSV rather than an `.xlsx`, because producing a real workbook in the browser
 * would mean a spreadsheet library in the bundle for one button, and because
 * every spreadsheet application opens a CSV — it is the format that arrives
 * somewhere rather than the format designed for arriving somewhere.
 *
 * The headings are the contract the importer reads. They are written here rather
 * than fetched from the API for the same reason the exporter writes them here:
 * the file in the author's hands and the file the parser expects are one thing,
 * and this is the copy a person reads.
 */
export function downloadImportTemplate(): void {
  const header = 'Type,Question,Option A,Option B,Option C,Option D,Answer,Explanation,Difficulty';

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
      'Easy',
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
      'Medium',
    ],
  ];

  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const csv = [header, ...rows.map((row) => row.map(cell).join(','))].join('\r\n') + '\r\n';

  downloadTextFile('quiz-questions-template.csv', csv, 'text/csv');
}
