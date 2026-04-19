"use client";

import { useState, useEffect } from "react";

interface Job {
  id: string;
  jobCode: string;
  name: string;
  status: string;
}

interface JobPickerProps {
  companyId: string | null;
  value: string | null;
  onChange: (jobId: string | null) => void;
  onCreateNew: () => void;
  refreshKey?: number;
}

export function JobPicker({
  companyId,
  value,
  onChange,
  onCreateNew,
  refreshKey = 0,
}: JobPickerProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setJobs([]);
      return;
    }
    setLoading(true);
    fetch(`/api/jobs?companyId=${companyId}`)
      .then((r) => r.json())
      .then((data) => {
        setJobs(data.jobs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [companyId, refreshKey]);

  if (!companyId) {
    return <p className="text-xs text-zinc-500 italic">Select a company first to choose a job.</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={loading}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          <option value="">{loading ? "Loading..." : "Select job..."}</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              [{j.jobCode}] {j.name} — {j.status}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCreateNew}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg whitespace-nowrap"
        >
          + New Job
        </button>
      </div>
      {!loading && jobs.length === 0 && (
        <p className="text-xs text-zinc-500">
          No jobs yet for this company. Click &quot;+ New Job&quot; to create one.
        </p>
      )}
    </div>
  );
}
