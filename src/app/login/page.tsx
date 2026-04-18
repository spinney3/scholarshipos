import Link from "next/link";
import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string };
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">
        Sign in to ScholarshipOS
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        New here?{" "}
        <Link
          href="/signup"
          className="text-brand-600 hover:text-brand-700 font-medium"
        >
          Create an account
        </Link>
        .
      </p>

      {searchParams.error && (
        <div className="mt-6 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {searchParams.error}
        </div>
      )}

      <LoginForm redirectTo={searchParams.redirect ?? "/matches"} />
    </div>
  );
}
