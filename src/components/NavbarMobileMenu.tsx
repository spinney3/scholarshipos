"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

/**
 * Mobile-only hamburger drawer. Rendered alongside the desktop link row in
 * Navbar, with responsive visibility: desktop row is `hidden sm:flex`, this
 * is `sm:hidden`. Kept as a standalone client component because Navbar is a
 * Server Component and owns the auth lookup.
 */
interface LinkItem {
  href: string;
  label: string;
}

interface Props {
  signedIn: boolean;
}

const AUTHED_LINKS: LinkItem[] = [
  { href: "/matches", label: "Matches" },
  { href: "/kanban", label: "Pipeline" },
  { href: "/vault", label: "Vault" },
  { href: "/onboarding", label: "Profile" },
];

const GUEST_LINKS: LinkItem[] = [
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Get started" },
];

export function NavbarMobileMenu({ signedIn }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = signedIn ? AUTHED_LINKS : GUEST_LINKS;

  // Close the drawer when the route changes — otherwise it stays open on
  // mobile after tap-through.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
      >
        {/* simple icon — avoids an extra dep */}
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-14 z-40 border-b border-slate-200 bg-white shadow-sm">
          <ul className="mx-auto flex max-w-6xl flex-col divide-y divide-slate-100">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="block px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            {signedIn && (
              <li className="px-4 py-3">
                <SignOutButton />
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
