'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { cn } from '@ui/lib/utils';
import { API_CHOICE_TITLES, loadChoices, type ChoiceScope } from '@/lib/api-choices';
import type { ApiChoiceSource } from '@/lib/api-reference';

/**
 * The list beside an id field, for the reader who does not have an id in hand.
 *
 * It reads what it can offer when it is opened rather than when the page loads:
 * most people come to this page with a key and a question, and loading nine
 * endpoint cards' worth of courses and lessons for the two fields they might
 * touch would be a page that greets everybody with a dozen requests.
 *
 * Picking fills the input; it does not submit anything, and it does not lock the
 * field. Everything the picker knows, the reader can also type — which is what
 * somebody integrating from a script needs, and what the picker would get wrong
 * the moment it claimed to know every id.
 */
export function FieldPicker({
  source,
  scope,
  value,
  onPick,
  label,
  className,
}: {
  source: ApiChoiceSource;
  scope: ChoiceScope;
  /** The field's current value, so the list can mark what is already chosen. */
  value: string;
  onPick: (next: string) => void;
  /** What this button does, for a screen reader: the chip shows only a chevron. */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const choices = useQuery({
    queryKey: [
      'docs',
      'choices',
      source,
      scope.spaceId ?? '',
      scope.orgId ?? '',
      scope.keyOrgId ?? '',
    ],
    queryFn: () => loadChoices(source, scope),
    enabled: open,
    // A list of courses does not change while somebody is reading an endpoint
    // card, and the second field that asks for the same list should not ask the
    // API for it again.
    staleTime: 60 * 1000,
    // A menu that retried three times before it said anything would read as a
    // menu that is broken rather than a request that was refused.
    retry: false,
  });

  const options = choices.data ?? [];

  // An organization's key makes for a short list, and a short list nobody
  // explained reads as a list that is missing something.
  const narrow = (source === 'courses' || source === 'lessons') && scope.keyOrgName;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn(
            'absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-full text-muted-foreground',
            className,
          )}
        >
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>

      {/* A menu of ids can be long, so it scrolls rather than growing past the
          card it belongs to. */}
      <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {API_CHOICE_TITLES[source]}
          </span>
          {choices.isFetching && (
            <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
        </DropdownMenuLabel>

        {narrow && (
          <p className="px-2 pb-1.5 text-xs text-muted-foreground">
            Only what {scope.keyOrgName} owns — this key was made for it.
          </p>
        )}

        <DropdownMenuSeparator />

        {choices.isError ? (
          <div className="grid gap-0.5 px-2 py-1.5">
            <p className="text-xs text-muted-foreground">
              {choices.error instanceof Error ? choices.error.message : 'Could not read the list.'}
            </p>
            <p className="text-xs text-muted-foreground">The field still takes a typed id.</p>
          </div>
        ) : options.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {choices.isFetching ? 'Loading…' : 'Nothing to pick here — type an id instead.'}
          </p>
        ) : (
          options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onPick(option.value)}
              className="items-start gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {option.detail ? `${option.detail} · ` : ''}
                  {option.value}
                </span>
              </span>
              {option.value === value && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
