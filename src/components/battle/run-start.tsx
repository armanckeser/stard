import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Customize } from "@/components/run/customize";
import { validLogin } from "@/lib/published-list";

type Props = {
  login: string;
  onLogin: (login: string) => void;
  onStart: (login: string) => void;
  loading: boolean;
  error: string;
  /** The run starting by itself from `/run?me=`: no form, only what is being read. */
  starting: string | null;
  className: string;
};

// The Play screen's start panel: one field and one button, with Customize your team as a
// quiet way in to the deck, ace and character before the first run. The rules wait in How
// to play (docs/GAME-UI.md §10). A link with ?me= starts the run with no typing.
export function RunStart({ login, onLogin, onStart, loading, error, starting, className }: Props) {
  if (starting && !error) {
    return (
      <div className={`${className} space-y-2 text-center`} role="status">
        <p className="font-display text-2xl font-bold tracking-tight">Play</p>
        <p className="text-sm text-white/70">Reading @{starting}'s stars...</p>
      </div>
    );
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); onStart(login.trim()); }} className={`${className} space-y-3`}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Play</h1>
      <Input value={login} onChange={(e) => onLogin(e.target.value.replace(/^@/, ""))} placeholder="Your GitHub username" aria-label="Your GitHub username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <Button type="submit" className="w-full" disabled={!validLogin(login) || loading}><Play /> {loading ? "Reading your stars..." : "Play"}</Button>
      <div className="run-panel-quiet flex-col">
        <Customize login={login.trim()} />
      </div>
      {error && <p className="text-sm text-[#ff8f93]" role="alert">{error}</p>}
    </form>
  );
}
