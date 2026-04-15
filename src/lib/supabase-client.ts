import { createClient } from "@supabase/supabase-js";

// Ensure these are defined in .env.local file
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. For local Docker development, run "npm run supabase:start", then "npm run supabase:env" and copy the printed NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY values into .env.local.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
