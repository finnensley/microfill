"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRequestOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");

    const emailRedirectTo = `${window.location.origin}/auth/callback?next=/dashboard`;

    const { error } = await supabaseBrowser.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });

    setSubmitting(false);

    if (error) {
      setStatus(`Unable to send sign-in code: ${error.message}`);
      return;
    }

    setStep("verify");
    setStatus(
      "Check your email. Click the sign-in link to continue immediately, or paste the one-time code below instead.",
    );
  };

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");

    const { error } = await supabaseBrowser.auth.verifyOtp({
      email,
      token: otpCode,
      type: "email",
    });

    setSubmitting(false);

    if (error) {
      setStatus(`Unable to verify sign-in code: ${error.message}`);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-8 text-white shadow-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-slate-400">
        Email sign-in is the current MVP auth path for both local development
        and the first production release. Protected routes will redirect here
        when no session is present. The link in the email signs you in directly.
        The one-time code below is a fallback if you prefer to paste it
        manually. Shopify OAuth is deferred until the core operator workflow is
        stable.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={step === "request" ? handleRequestOtp : handleVerifyOtp}
      >
        <div>
          <label className="mb-2 block text-sm text-slate-300" htmlFor="email">
            Work email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none ring-0 placeholder:text-slate-500"
            placeholder="you@company.com"
            required
            disabled={step === "verify" || submitting}
          />
        </div>

        {step === "verify" ? (
          <div>
            <label className="mb-2 block text-sm text-slate-300" htmlFor="otp">
              One-time code
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none ring-0 placeholder:text-slate-500"
              placeholder="Enter the email code"
              required
              disabled={submitting}
            />
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-green-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting
            ? "Working..."
            : step === "request"
              ? "Email me a sign-in link"
              : "Verify and continue"}
        </button>
      </form>

      {step === "verify" ? (
        <button
          type="button"
          onClick={() => {
            setStep("request");
            setOtpCode("");
            setStatus("");
          }}
          className="mt-3 text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
        >
          Use a different email
        </button>
      ) : null}

      {status ? <p className="mt-4 text-sm text-slate-300">{status}</p> : null}
    </div>
  );
}
