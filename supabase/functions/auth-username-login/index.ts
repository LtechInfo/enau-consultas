import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function signAppJwt(user: { user_id: string; username: string; role: string; name: string }) {
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
  if (!jwtSecret) throw new Error("SUPABASE_JWT_SECRET is required");

  const key = new TextEncoder().encode(jwtSecret);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 8; // 8h

  const token = await new SignJWT({
    app_role: user.role,
    username: user.username,
    display_name: user.name,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.user_id)
    .setIssuer("enau-consultas")
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  return { token, exp };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!serviceRoleKey || !supabaseUrl) {
      return json({ error: "server_misconfigured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!username || !password) {
      return json({ error: "missing_credentials" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.rpc("app_auth_username", {
      p_username: username,
      p_password: password,
    });
    if (error) return json({ error: "auth_failed" }, 401);
    if (!data || !Array.isArray(data) || data.length === 0) {
      return json({ error: "invalid_credentials" }, 401);
    }

    const row = data[0];
    const { token, exp } = await signAppJwt({
      user_id: row.user_id,
      username: row.username,
      role: row.role,
      name: row.name,
    });

    return json({
      access_token: token,
      token_type: "bearer",
      expires_at: exp,
      user: {
        id: row.user_id,
        username: row.username,
        name: row.name,
        role: row.role,
      },
    });
  } catch (err) {
    console.error(err);
    return json({ error: "internal_error" }, 500);
  }
});

