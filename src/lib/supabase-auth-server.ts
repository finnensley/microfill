import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-config";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { Database } from "@/types/supabase";

export async function createServerAuthClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components may not be able to persist cookies directly.
        }
      },
    },
  });
}

export async function getAuthenticatedUser() {
  const supabase = await createServerAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireAuthenticatedUser() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

function getTenantIdFromMetadata(user: User) {
  const tenantIdFromMetadata = user.app_metadata?.tenant_id;

  if (
    typeof tenantIdFromMetadata === "string" &&
    tenantIdFromMetadata.length > 0
  ) {
    return tenantIdFromMetadata;
  }

  return null;
}

async function getTenantIdFromAssignment(user: User) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_tenant_assignments")
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to resolve tenant assignment: ${error.message}`);
  }

  return data?.tenant_id ?? null;
}

export async function getTenantIdForUser(user: User) {
  const metadataTenantId = getTenantIdFromMetadata(user);

  if (metadataTenantId) {
    return metadataTenantId;
  }

  const assignedTenantId = await getTenantIdFromAssignment(user);

  if (assignedTenantId) {
    return assignedTenantId;
  }

  return null;
}

export async function getCurrentTenantId() {
  const user = await requireAuthenticatedUser();
  return getTenantIdForUser(user);
}

export function getDefaultTenantId() {
  return process.env.DEFAULT_TENANT_ID ?? null;
}
