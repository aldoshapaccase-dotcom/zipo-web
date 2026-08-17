// supabase-client.js
// Inicializa el cliente de Supabase.
//
// Como este proyecto es HTML/CSS/JS plano (sin Vite/Webpack), importamos
// la librería directo desde un CDN en formato ESM — así <script type="module">
// funciona en el navegador sin paso de compilación.
//
// Si más adelante migras a Vite/React, cambia esta línea por:
//   import { createClient } from "@supabase/supabase-js";
// y haz `npm install @supabase/supabase-js`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://hzdydiwlvifewcjldevg.supabase.co";       // <-- tu Project URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6ZHlkaXdsdmlmZXdjamxkZXZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4ODUwNTcsImV4cCI6MjEwMTQ2MTA1N30.mnBKrpj7L2lIM6MjD2mzzDhILAdLgozQZPALNBFOS-Q";                // <-- tu anon/public key

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
