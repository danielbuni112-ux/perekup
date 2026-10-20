import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Validates Telegram Mini App initData (HMAC-SHA256 with key derived from the bot token).
async function verify(initData: string, token: string) {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), token);
  if (hex(await hmac(secret, check)) !== hash) return null;
  const authDate = Number(p.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  const user = JSON.parse(p.get("user") || "null");
  return user && user.id ? user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) return json({ error: "bot_not_configured" }, 503);
    const { initData } = await req.json();
    const tg = await verify(String(initData || ""), token);
    if (!tg) return json({ error: "bad_init_data" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const email = `tg${tg.id}@users.perekup.app`;
    const name = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || `tg${tg.id}`;

    const { data: prof } = await admin.from("profiles").select("id").eq("telegram_id", tg.id).maybeSingle();
    let uid = prof?.id as string | undefined;
    if (!uid) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { username: (tg.username || `tg${tg.id}`).toLowerCase(), display_name: name, telegram_id: tg.id },
      });
      if (error && !/already/i.test(error.message)) throw error;
      uid = created?.user?.id;
      if (!uid) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        uid = list.users.find((u) => u.email === email)?.id;
      }
      if (!uid) throw new Error("user_not_created");
    }
    // Keep Telegram id and @username fresh (username is used for "Написать продавцу").
    await admin.from("profiles").update({ telegram_id: tg.id, tg_username: tg.username || null }).eq("id", uid);

    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (le) throw le;
    return json({ token_hash: link.properties.hashed_token, telegram_id: tg.id });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
