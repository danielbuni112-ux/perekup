import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Sends a Telegram notification to the other participant after a chat message is sent.
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://danielbuni112-ux.github.io/perekup/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!TOKEN) return json({ skipped: "no_token" });
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { message_id } = await req.json();
    const { data: msg } = await admin.from("messages").select("id, body, sender_id, conversation_id, created_at").eq("id", message_id).maybeSingle();
    if (!msg || msg.sender_id !== user.id) return json({ error: "not_found" }, 404);

    // Throttle: one notification per conversation per sender per minute.
    const since = new Date(new Date(msg.created_at).getTime() - 60_000).toISOString();
    const { count } = await admin.from("messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", msg.conversation_id).eq("sender_id", user.id).gte("created_at", since).lt("created_at", msg.created_at);
    if ((count || 0) > 0) return json({ skipped: "throttled" });

    const { data: conv } = await admin.from("conversations").select("id, buyer_id, seller_id, car_title").eq("id", msg.conversation_id).single();
    const toId = conv.buyer_id === user.id ? conv.seller_id : conv.buyer_id;
    const [{ data: to }, { data: from }] = await Promise.all([
      admin.from("profiles").select("telegram_id").eq("id", toId).single(),
      admin.from("profiles").select("username, display_name").eq("id", user.id).single(),
    ]);
    if (!to?.telegram_id) return json({ skipped: "no_telegram" });

    const who = from?.display_name || from?.username || "Пользователь";
    const text = `Новое сообщение от <b>${escHtml(who)}</b>${conv.car_title ? ` · ${escHtml(conv.car_title)}` : ""}\n${escHtml(msg.body.slice(0, 300))}`;
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: to.telegram_id, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Открыть чат", web_app: { url: `${APP_URL}#c-${conv.id}` } }]] } }),
    });
    const tr = await r.json();
    return json({ sent: tr.ok, error: tr.ok ? undefined : tr.description });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
