const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
export { GOOGLE_CLIENT_ID };
