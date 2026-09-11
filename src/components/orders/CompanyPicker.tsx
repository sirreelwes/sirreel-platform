"use client";

import { useEffect, useRef, useState } from "react";

interface Company {
  id: string;
  name: string;
}

interface CompanyPickerProps {
  value: string | null;
  selectedName?: string | null;
  /** Pre-runs the search with this text — used to seed the box with a name
   *  the CLIENT typed (see ClientDetailSuggestion) so their words go through
   *  the same near-match search as anything an agent types, rather than a
   *  separate create path. Changing it re-seeds; clearing it does nothing. */
  initialQuery?: string;
  onChange: (id: string, name: string) => void;
  /** Offers "+ Create new company: “<typed>”" as the LAST row of the
   *  dropdown — after the hits, or alone when nothing matched. Without it
   *  a miss reads "No results" and the rep has to find a separate "+ New
   *  company" link, which the floating dropdown was covering (Wes,
   *  2026-09-10: the Reserve-the-request form "doesn't offer Create New
   *  Company like on other forms"). The parent owns the actual create so
   *  its 409 near-match discipline stays where it is. */
  onCreate?: (name: string) => void;
  /** `dark` is the original zinc look for pickers that sit inside an
   *  opaque dark card. `light` is for the staff shell's cream content area,
   *  where the dark box reads as a foreign object. */
  tone?: "dark" | "light";
}

const TONES = {
  dark: {
    selected: "bg-zinc-800 border border-zinc-700",
    selectedText: "text-white",
    change: "text-zinc-500 hover:text-zinc-300",
    input: "bg-zinc-800 border border-zinc-700 text-white focus:border-zinc-500",
    menu: "bg-zinc-800 border border-zinc-700 shadow-xl",
    row: "text-white hover:bg-zinc-700",
    muted: "text-zinc-500",
    create: "text-amber-400 hover:bg-zinc-700 border-t border-zinc-700",
  },
  light: {
    selected: "bg-lt-inner border border-lt-hairline",
    selectedText: "text-lt-fg",
    change: "text-lt-fg3 hover:text-lt-fg",
    input: "bg-lt-card border border-lt-hairline text-lt-fg focus:border-lt-fg3",
    menu: "bg-lt-card border border-lt-hairline shadow-lg",
    row: "text-lt-fg hover:bg-lt-inner",
    muted: "text-lt-fg3",
    create: "text-amber-700 hover:bg-lt-inner border-t border-lt-hairline",
  },
} as const;

export function CompanyPicker({
  value,
  selectedName,
  initialQuery,
  onChange,
  onCreate,
  tone = "dark",
}: CompanyPickerProps) {
  const t = TONES[tone];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = async (q: string) => {
    setQuery(q);
    setOpen(true);
    if (q.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/companies?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.companies || []);
      setSearching(false);
    } catch {
      setSearching(false);
    }
  };

  // Seed on mount and whenever the seed text changes. Guarded on `value` so
  // re-seeding can never clobber a company the agent has already picked.
  useEffect(() => {
    if (!initialQuery || value) return;
    void search(initialQuery);
    // search is stable enough for this purpose — it only closes over setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, value]);

  // The dropdown floats over whatever sits under the box, so it has to get
  // out of the way when the rep clicks elsewhere.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c: Company) => {
    onChange(c.id, c.name);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const clear = () => {
    onChange("", "");
    setQuery("");
    setResults([]);
  };

  const create = () => {
    const name = query.trim();
    if (!name || !onCreate) return;
    onCreate(name);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  if (value && selectedName) {
    return (
      <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${t.selected}`}>
        <div className={`text-sm ${t.selectedText}`}>{selectedName}</div>
        <button type="button" onClick={clear} className={`text-xs ${t.change}`}>
          Change
        </button>
      </div>
    );
  }

  const typed = query.trim();
  const showMenu = open && typed.length > 0;

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        value={query}
        onChange={(e) => search(e.target.value)}
        onFocus={() => typed.length > 0 && setOpen(true)}
        placeholder={onCreate ? "Search companies, or type a new name…" : "Search companies..."}
        className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none ${t.input}`}
      />
      {showMenu && (
        <div className={`absolute z-10 left-0 right-0 mt-1 rounded-lg max-h-64 overflow-y-auto ${t.menu}`}>
          {searching ? (
            <div className={`px-3 py-2 text-xs ${t.muted}`}>Searching...</div>
          ) : (
            <>
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c)}
                  className={`w-full text-left px-3 py-2 text-sm ${t.row}`}
                >
                  {c.name}
                </button>
              ))}
              {results.length === 0 && !onCreate && (
                <div className={`px-3 py-2 text-xs ${t.muted}`}>No results</div>
              )}
              {onCreate && (
                <button
                  type="button"
                  onClick={create}
                  className={`w-full text-left px-3 py-2 ${t.create}`}
                >
                  <div className="text-sm font-semibold">+ Create new company: &ldquo;{typed}&rdquo;</div>
                  <div className={`text-[11px] ${t.muted}`}>
                    {results.length === 0
                      ? "Nothing on file by that name."
                      : "Not one of the above — a similar name is checked before it's created."}
                  </div>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
