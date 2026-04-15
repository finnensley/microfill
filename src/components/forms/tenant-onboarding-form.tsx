"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

interface TenantOption {
  label: string;
  tenantId: string;
}

interface TenantOnboardingFormProps {
  defaultTenantId: string | null;
  email: string | null;
  tenantOptions: TenantOption[];
}

export function TenantOnboardingForm({
  defaultTenantId,
  email,
  tenantOptions,
}: TenantOnboardingFormProps) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(
    defaultTenantId &&
      tenantOptions.some((option) => option.tenantId === defaultTenantId)
      ? defaultTenantId
      : (tenantOptions[0]?.tenantId ?? ""),
  );
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");

    const response = await fetch("/api/tenant-assignment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenantId }),
    });

    const payload = (await response.json()) as { error?: string };

    setSubmitting(false);

    if (!response.ok) {
      setStatus(payload.error || "Unable to save tenant assignment.");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
          Tenant Onboarding
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          Connect your account to a tenant
        </h1>
        <p className="text-sm text-slate-600">
          Signed in as {email || "unknown user"}. Choose the tenant this account
          should access.
        </p>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label
            className="mb-2 block text-sm font-medium text-slate-700"
            htmlFor="tenantId"
          >
            Tenant
          </label>
          <select
            id="tenantId"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-950"
            required
            disabled={submitting || tenantOptions.length === 0}
          >
            {tenantOptions.map((option) => (
              <option key={option.tenantId} value={option.tenantId}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {tenantOptions.length === 0 ? (
          <p className="text-sm text-rose-700">
            No tenants are available yet. Seed a tenant first, then return to
            onboarding.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !tenantId}
          className="w-full rounded-lg bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Saving..." : "Continue to dashboard"}
        </button>
      </form>

      {defaultTenantId ? (
        <p className="mt-4 text-xs text-slate-500">
          Recommended local tenant: {defaultTenantId}
        </p>
      ) : null}

      {status ? <p className="mt-4 text-sm text-rose-700">{status}</p> : null}
    </div>
  );
}
