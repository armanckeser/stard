import { REPO_URL } from "@/lib/published-list";

// How to play's last line: who a run is played against, and how an account asks to be left out.
export function OpponentsLink() {
  return (
    <a href={`${REPO_URL}/blob/main/OPPONENTS.md`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-white">Opponents: real GitHub players</a>
  );
}
