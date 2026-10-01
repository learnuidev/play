import type { QuizQuestion } from '@play/types';

/**
 * A quiz as a file.
 *
 * The other half of the import: a quiz that can be read out and edited in a
 * spreadsheet is a quiz an author can review offline, hand to somebody else, and
 * bring back — and it is how the import format gets tested by the people using
 * it rather than by the people who wrote the parser.
 *
 * Both shapes are produced here rather than by the API, and that is deliberate:
 * the author's page already holds every question, so exporting is a `Blob` and a
 * click. An export route would be a second read of the same rows, and a second
 * place for the file's columns to be described.
 */

/** The headings the importer reads, in the order a person reads them. */
const CSV_HEADER = ['Type', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F', 'Answer', 'Explanation', 'Difficulty'];

/** Quote a cell if it holds anything that would otherwise break the row. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A quiz as CSV: one row per question, the answer as a letter.
 *
 * A letter rather than the option's text, because the text may contain a comma
 * and because there is no question about which of two identical-looking options
 * was meant. `QuestionOption.id` is already the letter, which is exactly why the
 * answer is stored that way.
 */
export function questionsToCsv(questions: QuizQuestion[]): string {
  const rows = questions.map((question) => {
    const options = [0, 1, 2, 3, 4, 5].map((index) => question.options[index]?.text ?? '');
    const answer = question.correctOptionIds[0] ?? '';

    return [
      question.type,
      question.prompt,
      ...options,
      // `a`…`f` are the option ids, so uppercasing one is the letter a
      // spreadsheet column shows.
      answer.toUpperCase(),
      question.explanation ?? '',
      // The level as it is stored, like the type beside it — and blank for a
      // question nobody graded, which the importer reads back as no level.
      question.difficulty ?? '',
    ];
  });

  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * A quiz as JSON: the shape the importer accepts, with the status and the notes
 * about who wrote it left in.
 *
 * Unlike the CSV, which is for reading and editing, this is a copy: it is what
 * an author would keep, move to another quiz, or check into a repository — so it
 * says everything the question says.
 */
export function questionsToJson(questions: QuizQuestion[]): string {
  return (
    JSON.stringify(
      {
        questions: questions.map((question) => ({
          type: question.type,
          prompt: question.prompt,
          options: question.options.map((option) => option.text),
          answer: (question.correctOptionIds[0] ?? '').toUpperCase(),
          ...(question.explanation ? { explanation: question.explanation } : {}),
          ...(question.difficulty ? { difficulty: question.difficulty } : {}),
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

/** Hands a generated file to the browser, as a download. */
export function downloadTextFile(fileName: string, text: string, contentType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${contentType};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick rather than immediately: Safari has been known to
  // cancel a download whose object URL is released in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Turns a quiz's title into a file name somebody can find again. */
export function quizFileName(title: string, extension: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${slug || 'quiz'}.${extension}`;
}
