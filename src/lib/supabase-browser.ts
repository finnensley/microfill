import { createClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-config";
import { Database } from "@/types/supabase";

export const supabaseBrowser = createClient<Database>(
  getSupabaseUrl(),
  getSupabaseAnonKey(),
);
