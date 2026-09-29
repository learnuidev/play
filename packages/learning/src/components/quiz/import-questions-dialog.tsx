'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangleIcon, DownloadIcon, FileSpreadsheetIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/ui/dialog';
import { Label } from '@ui/components/ui/label';
import { useSections } from '@api/modules/section/section.queries';
import { useImportQuestions } from '@api/modules/question/question.queries';
import { IMPORT_EXTENSIONS, MAX_IMPORT_BYTES, downloadImportTemplate, readFileAsBase64 } from '@learning/lib/question-file';
import type { ImportQuestionsResponse } from '@play/types';

const MAX_ROWS = 300;
const MAX_MB = MAX_IMPORT_BYTES / 1024 / 1024;

/** Where a row that could not be read is named, so the author can go and look. */
function SkippedRows({ skipped }: { skipped: ImportQuestionsResponse['skipped'] }) {
  return (
    <div className="rounded-2xl border border-amber-600/30 bg-amber-500/5 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangleIcon className="size-4" />
        {skipped.length} row{skipped.length === 1 ? '' : 's'} could not be read
      </p>
      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
        {skipped.slice(0, 8).map((row) => (
          <li key={row.row}>
            Line {row.row}: {row.error}
          </li>
        ))}
        {skipped.length > 8 && <li>…and {skipped.length - 8} more.</li>}
      </ul>
    </div>
  );
}

/**
 * Bringing a quiz in from a file.
 *
 * The dialog is the whole of the file's documentation: the columns, an example,
 * and a template to download — because a format described in a README is a
 * format somebody has to leave the page to read, and the person importing a
 * spreadsheet is holding the file in the other hand.
 *
 * Two things it refuses to do quietly. A file that is too large, or of a kind
 * nothing reads, fails as a whole and says why. A file whose *rows* are partly
 * wrong imports the ones that are right and lists the lines that were not —
 * which is the only useful answer for a spreadsheet somebody has been keeping
 * for years.
 */
export function ImportQuestionsDialog({
  contentId,
  spaceId,
  open,
  onOpenChange,
}: {
  contentId: string;
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceContentId, setSourceContentId] = useState('');
  const [result, setResult] = useState<ImportQuestionsResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: outline } = useSections(spaceId);
  const importQuestions = useImportQuestions(contentId);

  const lessons = (outline?.sections ?? []).flatMap((section) =>
    section.contents.filter((content) => content.type === 'VIDEO').map((content) => ({ contentId: content.contentId, title: content.title })),
  );

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setSourceContentId('');
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);

  async function submit() {
    if (!file) return;

    try {
      const contentBase64 = await readFileAsBase64(file);
      const response = await importQuestions.mutateAsync({
        fileName: file.name,
        contentBase64,
        ...(sourceContentId ? { sourceContentId } : {}),
      });

      setResult(response);
      toast.success(
        `${response.imported.length} question${response.imported.length === 1 ? '' : 's'} imported` +
          (response.skipped.length > 0 ? `, ${response.skipped.length} row(s) skipped` : ''),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import that file');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import questions</DialogTitle>
          <DialogDescription>
            A spreadsheet (.xlsx), a CSV, or a JSON file. Every question lands needing
            verification, whichever way it arrived.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-4">
            <p className="text-sm">
              Read <span className="font-medium tabular-nums">{result.rows}</span> row
              {result.rows === 1 ? '' : 's'} and imported{' '}
              <span className="font-medium tabular-nums">{result.imported.length}</span> question
              {result.imported.length === 1 ? '' : 's'}.
            </p>
            {result.skipped.length > 0 && <SkippedRows skipped={result.skipped} />}
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="import-file">File</Label>
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept={IMPORT_EXTENSIONS.join(',')}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Up to {MAX_ROWS} questions and {MAX_MB} MB at a time.
              </p>
            </div>

            {lessons.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="import-source">Written from</Label>
                <select
                  id="import-source"
                  value={sourceContentId}
                  onChange={(event) => setSourceContentId(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                >
                  <option value="">Not from a particular lesson</option>
                  {lessons.map((lesson) => (
                    <option key={lesson.contentId} value={lesson.contentId}>
                      {lesson.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FileSpreadsheetIcon className="size-4" />
                What the file should look like
              </p>
              <p className="mt-2">
                One question per row, with a heading row:{' '}
                <span className="text-foreground">
                  Type, Question, Option A, Option B, Option C, Option D, Answer, Explanation
                </span>
                . The answer is a letter (<span className="text-foreground">A</span>), or{' '}
                <span className="text-foreground">True</span>/<span className="text-foreground">False</span>{' '}
                for a true/false question. The type can be left out: a row with options is multiple
                choice, and one without them is true/false.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={downloadImportTemplate}
              >
                <DownloadIcon />
                Download the template
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button type="button" variant="outline" onClick={() => setResult(null)}>
                Import another file
              </Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="button" onClick={submit} disabled={!file || importQuestions.isPending}>
                {importQuestions.isPending && <Loader2Icon className="animate-spin" />}
                Import
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
