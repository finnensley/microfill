import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-config";
import { Database } from "@/types/supabase";

export const supabaseBrowser = createBrowserClient<Database>(
  getSupabaseUrl(),
  getSupabaseAnonKey(),
);
