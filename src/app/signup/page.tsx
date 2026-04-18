import Link from "next/link";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">
        Create your ScholarshipOS account
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Already have one?{" "}
        <Link
          href="/login"
          className="text-brand-600 hover:text-brand-700 font-medium"
        >
          Sign in
        </Link>
        .
      </p>
      <SignupForm />
    </div>
  );
}
