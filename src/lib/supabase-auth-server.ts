import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-config";
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

export function getTenantIdForUser(user: User) {
  const tenantIdFromMetadata = user.app_metadata?.tenant_id;

  if (
    typeof tenantIdFromMetadata === "string" &&
    tenantIdFromMetadata.length > 0
  ) {
    return tenantIdFromMetadata;
  }

  const defaultTenantId = process.env.DEFAULT_TENANT_ID;

  if (defaultTenantId) {
    return defaultTenantId;
  }

  return null;
}

export async function getCurrentTenantId() {
  const user = await requireAuthenticatedUser();
  return getTenantIdForUser(user);
}
