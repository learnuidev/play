'use client';

import { HeartIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import { useToggleFavourite } from '@api/modules/learning/learning.queries';

/**
 * The heart on a lesson: the one control that keeps a video for later.
 *
 * It carries the count, because a like nobody can see is a note to yourself —
 * the same treatment the heart on a comment gets, one size up, so the two read
 * as the same act in the same product.
 *
 * It is an outline pill beside the lesson's one decision rather than a pill of
 * its own shape: marking a lesson complete is where a reader is going, and
 * saving it is what they do on the way. The colour is the whole of the
 * difference between the two states, which is what lets the count stay where it
 * is instead of the label saying "Saved".
 *
 * The answer is the server's: the button is drawn from the cached content, and
 * the mutation writes the new state and count into it from the response, so the
 * heart fills on the press rather than a request later.
 */
export function ContentFavourite({
  contentId,
  favourited,
  count,
  showCount = true,
}: {
  contentId: string;
  /** Whether the person reading has favourited this lesson. */
  favourited: boolean;
  /** How many people have, this one included. */
  count: number;
  /**
   * Whether the count is drawn beside the heart, which the lesson wants and a
   * card in a grid does not.
   *
   * On the lesson it is the count of the thing being read, and a like nobody can
   * see is a note to yourself. Over a thumbnail it would be a number written on
   * a picture, in a page that lists a dozen of them — so the heart keeps its
   * state and gives up its arithmetic, which is the half of it a card needs.
   */
  showCount?: boolean;
}) {
  const favourite = useToggleFavourite(contentId);
  const label = favourited ? 'Remove from your favourites' : 'Save this lesson to your favourites';

  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={favourited}
      aria-label={label}
      title={label}
      onClick={() =>
        favourite.mutate(favourited, {
          onError: (err) =>
            toast.error(
              err instanceof Error ? err.message : 'Could not save this lesson',
            ),
        })
      }
      className={cn(
        'shrink-0 tabular-nums',
        !showCount && 'px-2',
        favourited &&
          'border-rose-600/40 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 hover:text-rose-700 dark:border-rose-400/40 dark:text-rose-400 dark:hover:bg-rose-500/15 dark:hover:text-rose-300',
      )}
    >
      <HeartIcon className={cn(favourited && 'fill-current')} />
      {/* Nothing at all until somebody has hearted it: a zero beside a control
          that has never been used is a count of nothing. */}
      {showCount && count > 0 && count}
    </Button>
  );
}
