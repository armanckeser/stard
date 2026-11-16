import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CONDITION_WORDS, conditionOfWord, conditionTip, withFirst } from "../../../server/run/names";

const DOTTED = "underline decoration-dotted underline-offset-2";

/** The name a boost's `{first}` shows: the repo of the team's first card. */
export const firstName = (fullName: string | undefined): string | undefined => (fullName ? (fullName.split("/")[1] ?? fullName) : undefined);

/**
 * Card text with `{first}` named and its condition word dotted: tap or hover the word to
 * read what the condition does. Where the text sits inside a button or a hover tip (the
 * boost pick, the checks), the word can't be a button of its own, so it carries a title.
 */
export function CardText({ text, first, plain = false }: { text: string; first?: string; plain?: boolean }) {
  const shown = withFirst(text, first);
  const match = CONDITION_WORDS.exec(shown);
  if (!match) return <>{shown}</>;
  const word = match[0];
  const tip = conditionTip(conditionOfWord(word));
  return (
    <>
      {shown.slice(0, match.index)}
      {plain ? (
        <span className={DOTTED} title={tip}>{word}</span>
      ) : (
        <Popover>
          <PopoverTrigger openOnHover delay={150} render={<button type="button" className={`${DOTTED} cursor-help`} />}>
            {word}
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-64 p-2 text-xs">{tip}</PopoverContent>
        </Popover>
      )}
      {shown.slice(match.index + word.length)}
    </>
  );
}
