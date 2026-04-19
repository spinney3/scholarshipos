import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { NavbarMobileMenu } from "./NavbarMobileMenu";

export async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="relative bg-white border-b border-slate-200">
      <nav className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="font-semibold text-lg tracking-tight text-slate-900"
        >
          ScholarshipOS
        </Link>

        {/* Desktop links — hidden under sm breakpoint */}
        <div className="hidden sm:flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link
                href="/matches"
                className="text-slate-600 hover:text-slate-900"
              >
                Matches
              </Link>
              <Link
                href="/kanban"
                className="text-slate-600 hover:text-slate-900"
              >
                Pipeline
              </Link>
              <Link
                href="/vault"
                className="text-slate-600 hover:text-slate-900"
              >
                Vault
              </Link>
              <Link
                href="/onboarding"
                className="text-slate-600 hover:text-slate-900"
              >
                Profile
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-slate-600 hover:text-slate-900"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-brand-500 px-3 py-1.5 text-white hover:bg-brand-600"
              >
                Get started
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger — visible only under sm breakpoint */}
        <NavbarMobileMenu signedIn={!!user} />
      </nav>
    </header>
  );
}
