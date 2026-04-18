import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { VaultEssay, VaultPromptType } from "@/lib/types";
import {
  VAULT_PROMPT_TYPE_LABELS,
  VAULT_PROMPT_TYPE_OPTIONS,
} from "@/lib/types";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: { type?: string };
}

export default async function VaultPage({ searchParams }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/vault");

  const filter =
    searchParams?.type &&
    VAULT_PROMPT_TYPE_OPTIONS.some((o) => o.value === searchParams.type)
      ? (searchParams.type as VaultPromptType)
      : null;

  let q = supabase
    .from("vault_essays")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (filter) q = q.eq("prompt_type", filter);

  const { data, error } = await q;
  const essays = (data ?? []) as VaultEssay[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Essay vault</h1>
          <p className="mt-1 text-sm text-slate-600">
            Your library of finished essays. Tag each one by prompt type so you
            can reuse them on future scholarships.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/vault/adapt"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Adapt for new prompt
          </Link>
          <Link
            href="/vault/new"
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            New essay
          </Link>
        </div>
      </header>

      <PromptTypeFilter current={filter} />

      {error ? (
        <p className="mt-6 text-sm text-rose-600">
          Could not load vault: {error.message}
        </p>
      ) : essays.length === 0 ? (
        <EmptyState filtered={!!filter} />
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {essays.map((e) => (
            <EssayTile key={e.id} essay={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PromptTypeFilter({ current }: { current: VaultPromptType | null }) {
  return (
    <nav className="mt-6 flex flex-wrap gap-2 text-xs">
      <FilterChip href="/vault" active={!current}>
        All
      </FilterChip>
      {VAULT_PROMPT_TYPE_OPTIONS.map((o) => (
        <FilterChip
          key={o.value}
          href={`/vault?type=${o.value}`}
          active={current === o.value}
        >
          {o.label}
        </FilterChip>
      ))}
    </nav>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-brand-500 px-3 py-1 font-medium text-white"
          : "rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50"
      }
    >
      {children}
    </Link>
  );
}

function EssayTile({ essay }: { essay: VaultEssay }) {
  const snippet =
    essay.content.trim().slice(0, 180).replace(/\s+/g, " ") +
    (essay.content.length > 180 ? "…" : "");
  const updated = new Date(essay.updated_at);
  return (
    <li className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/vault/${essay.id}`}
          className="text-sm font-medium text-slate-900 hover:text-brand-700"
        >
          {essay.title}
        </Link>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
          {VAULT_PROMPT_TYPE_LABELS[essay.prompt_type]}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-xs text-slate-500">
        {snippet || <em className="text-slate-400">Empty draft</em>}
      </p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
        <span>{essay.word_count.toLocaleString()} words</span>
        <span>
          Updated{" "}
          {updated.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </li>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="mt-8 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm text-slate-600">
        {filtered
          ? "No essays match this prompt type yet."
          : "Your vault is empty. Save a finished essay here and the Adapt tool will surface it when you start a similar prompt."}
      </p>
      <div className="mt-4 flex justify-center">
        <Link
          href="/vault/new"
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Add your first essay
        </Link>
      </div>
    </div>
  );
}
