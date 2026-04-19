"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  INTEREST_OPTIONS,
  type FinancialNeed,
  type Profile,
} from "@/lib/types";

const STEPS = [
  "Basics",
  "Academics",
  "College Plans",
  "Interests",
  "Financial Need",
] as const;

interface Props {
  initial: Profile | null;
}

export function OnboardingWizard({ initial }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [gpa, setGpa] = useState<string>(
    initial?.gpa !== null && initial?.gpa !== undefined
      ? String(initial.gpa)
      : "",
  );
  const [zip, setZip] = useState(initial?.zip_code ?? "");
  const [intendedCollege, setIntendedCollege] = useState(
    initial?.intended_college ?? "",
  );
  const [intendedMajor, setIntendedMajor] = useState(
    initial?.intended_major ?? "",
  );
  const [allowMarketingEmails, setAllowMarketingEmails] = useState<boolean>(
    initial?.allow_marketing_emails ?? true,
  );
  const [interests, setInterests] = useState<string[]>(
    initial?.interests ?? [],
  );
  const [need, setNeed] = useState<FinancialNeed | "">(
    initial?.financial_need ?? "",
  );

  function toggleInterest(value: string) {
    setInterests((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!fullName.trim()) return "Please enter your name.";
    }
    if (step === 1) {
      const n = parseFloat(gpa);
      if (isNaN(n) || n < 0 || n > 4.5) return "Enter a GPA between 0 and 4.5.";
      if (!/^\d{5}$/.test(zip)) return "Enter a 5-digit ZIP code.";
    }
    if (step === 2) {
      // College plans step — both fields optional. No-op.
    }
    if (step === 3) {
      if (interests.length === 0) return "Pick at least one interest.";
    }
    if (step === 4) {
      if (!need) return "Select your financial need level.";
    }
    return null;
  }

  async function handleNext() {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }

    // Final submit
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You need to be signed in.");
      setSaving(false);
      return;
    }

    const { error: upsertError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        gpa: parseFloat(gpa),
        zip_code: zip,
        intended_college: intendedCollege.trim() || null,
        intended_major: intendedMajor.trim() || null,
        allow_marketing_emails: allowMarketingEmails,
        interests,
        financial_need: need,
        onboarded: true,
      })
      .eq("id", user.id);

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    // Live scraping is now handled out-of-band by a local weekly job that
    // Shawn runs and commits back to the seeded catalog. The onboarding
    // path intentionally doesn't trigger a per-student scrape anymore —
    // Vercel's Hobby 10s function cap made the live path unreliable, and
    // the catalog is now the canonical source of local scholarships.

    router.push("/matches");
    router.refresh();
  }

  return (
    <div>
      <ProgressHeader step={step} />

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
        {step === 0 && (
          <StepBasics fullName={fullName} onChange={setFullName} />
        )}
        {step === 1 && (
          <StepAcademics
            gpa={gpa}
            zip={zip}
            onGpa={setGpa}
            onZip={setZip}
          />
        )}
        {step === 2 && (
          <StepCollegePlans
            college={intendedCollege}
            major={intendedMajor}
            allowEmails={allowMarketingEmails}
            onCollege={setIntendedCollege}
            onMajor={setIntendedMajor}
            onAllowEmails={setAllowMarketingEmails}
          />
        )}
        {step === 3 && (
          <StepInterests
            selected={interests}
            onToggle={toggleInterest}
          />
        )}
        {step === 4 && <StepFinancial value={need} onChange={setNeed} />}

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || saving}
            className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {saving
              ? "Saving…"
              : step === STEPS.length - 1
                ? "Finish & see matches"
                : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressHeader({ step }: { step: number }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">
        Tell us about you
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        We'll use this to match you against scholarships you can actually win.
      </p>
      <ol className="mt-6 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <div
              className={`h-1.5 rounded-full ${
                i <= step ? "bg-brand-500" : "bg-slate-200"
              }`}
            />
            <p
              className={`mt-1.5 text-xs ${
                i === step ? "text-slate-900 font-medium" : "text-slate-500"
              }`}
            >
              {label}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepBasics({
  fullName,
  onChange,
}: {
  fullName: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="font-medium text-slate-900">What's your name?</h2>
      <p className="text-sm text-slate-600">
        This is how counselors will find you later.
      </p>
      <label className="block mt-4 text-sm font-medium text-slate-700">
        Full name
      </label>
      <input
        value={fullName}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-brand-500"
        placeholder="Jane Smith"
      />
    </div>
  );
}

function StepAcademics({
  gpa,
  zip,
  onGpa,
  onZip,
}: {
  gpa: string;
  zip: string;
  onGpa: (v: string) => void;
  onZip: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="font-medium text-slate-900">Academics & location</h2>
      <p className="text-sm text-slate-600">
        Your ZIP unlocks local scholarships that never appear on Fastweb.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Unweighted GPA
          </label>
          <input
            value={gpa}
            onChange={(e) => onGpa(e.target.value)}
            inputMode="decimal"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-brand-500"
            placeholder="3.75"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            ZIP code
          </label>
          <input
            value={zip}
            onChange={(e) => onZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-brand-500"
            placeholder="94110"
          />
        </div>
      </div>
    </div>
  );
}

function StepCollegePlans({
  college,
  major,
  allowEmails,
  onCollege,
  onMajor,
  onAllowEmails,
}: {
  college: string;
  major: string;
  allowEmails: boolean;
  onCollege: (v: string) => void;
  onMajor: (v: string) => void;
  onAllowEmails: (v: boolean) => void;
}) {
  return (
    <div>
      <h2 className="font-medium text-slate-900">College plans</h2>
      <p className="text-sm text-slate-600">
        Optional, but lets us match you with peers heading to the same schools
        and majors (and surface scholarships tied to specific universities).
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Intended college
          </label>
          <input
            value={college}
            onChange={(e) => onCollege(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-brand-500"
            placeholder="Penn State"
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave blank if you're still deciding.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Intended major
          </label>
          <input
            value={major}
            onChange={(e) => onMajor(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-brand-500"
            placeholder="Biomedical engineering"
          />
          <p className="mt-1 text-xs text-slate-500">Undecided is fine too.</p>
        </div>
      </div>
      <label className="mt-6 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={allowEmails}
          onChange={(e) => onAllowEmails(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">
            OK to email me occasional updates.
          </span>{" "}
          New scholarships in your region, product updates, and (someday)
          upgrade news. No spam, unsubscribe anytime.
        </span>
      </label>
    </div>
  );
}

function StepInterests({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="font-medium text-slate-900">
        What are you into? (Pick all that apply)
      </h2>
      <p className="text-sm text-slate-600">
        We'll surface scholarships tagged for these areas.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {INTEREST_OPTIONS.map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={`rounded-full px-3 py-1.5 text-sm border transition ${
                active
                  ? "bg-brand-500 text-white border-brand-500"
                  : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepFinancial({
  value,
  onChange,
}: {
  value: FinancialNeed | "";
  onChange: (v: FinancialNeed) => void;
}) {
  const opts: { v: FinancialNeed; label: string; hint: string }[] = [
    { v: "low", label: "Low", hint: "Family can cover most of college." },
    {
      v: "medium",
      label: "Medium",
      hint: "Some contribution, needs meaningful aid.",
    },
    { v: "high", label: "High", hint: "Most costs must come from aid." },
  ];
  return (
    <div>
      <h2 className="font-medium text-slate-900">Financial need</h2>
      <p className="text-sm text-slate-600">
        Many scholarships weight awards by family financial need. Your answer
        stays private.
      </p>
      <div className="mt-4 grid gap-2">
        {opts.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={`text-left rounded-md border px-4 py-3 transition ${
                active
                  ? "border-brand-500 ring-1 ring-brand-500 bg-brand-50"
                  : "border-slate-300 bg-white hover:border-slate-400"
              }`}
            >
              <div className="font-medium text-slate-900">{o.label}</div>
              <div className="text-sm text-slate-600">{o.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
