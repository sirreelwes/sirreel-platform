"use client";

import { useState } from "react";

interface Company {
  id: string;
  name: string;
}

interface CompanyPickerProps {
  value: string | null;
  selectedName?: string | null;
  onChange: (id: string, name: string) => void;
}

export function CompanyPicker({ value, selectedName, onChange }: CompanyPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async (q: string) => {
    setQuery(q);
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

  const pick = (c: Company) => {
    onChange(c.id, c.name);
    setQuery("");
    setResults([]);
  };

  const clear = () => {
    onChange("", "");
    setQuery("");
    setResults([]);
  };

  if (value && selectedName) {
    return (
      <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
        <div className="text-sm text-white">{selectedName}</div>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search companies..."
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
      />
      {query.length > 0 && (results.length > 0 || searching) && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {searching ? (
            <div className="px-3 py-2 text-xs text-zinc-500">Searching...</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      )}
      {query.length > 0 && !searching && results.length === 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl">
          <div className="px-3 py-2 text-xs text-zinc-500">No results</div>
        </div>
      )}
    </div>
  );
}
