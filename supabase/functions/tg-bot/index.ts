const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://danielbuni112-ux.github.io/perekup/";
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method: string, body: unknown) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await r.json();
}
async function secret() {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("perekup:" + TOKEN)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
const openBtn = (text: string, hash = "") => ({ inline_keyboard: [[{ text, web_app: { url: APP_URL + hash } }]] });

Deno.serve(async (req) => {
  if (!TOKEN) return new Response(JSON.stringify({ error: "set TELEGRAM_BOT_TOKEN" }), { status: 503 });
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("me") === "1") {
    const me = await tg("getMe", {});
    return new Response(JSON.stringify({ ok: me.ok, username: me.result?.username, name: me.result?.first_name, error: me.description }), { headers: { "Content-Type": "application/json" } });
  }

  // One-time setup: registers webhook, menu button, commands, description.
  if (req.method === "GET" && url.searchParams.get("setup") === "1") {
    const self = `https://${url.host}/functions/v1/tg-bot`;
    const out = {
      webhook: await tg("setWebhook", { url: self, secret_token: await secret(), allowed_updates: ["message"] }),
      menu: await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Гараж", web_app: { url: APP_URL } } }),
      commands: await tg("setMyCommands", { commands: [{ command: "start", description: "Открыть гараж" }] }),
      description: await tg("setMyDescription", { description: "Органайзер для перекупа: машины в наличии, учёт покупки, ремонта и прибыли, лента перекупов, на которых ты подписан." }),
      short: await tg("setMyShortDescription", { short_description: "Гараж и учёт прибыли для перекупа" }),
    };
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("ok");
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await secret()) return new Response("forbidden", { status: 403 });

  try {
    const upd = await req.json();
    const msg = upd.message;
    if (!msg?.chat?.id) return new Response("ok");
    const text: string = msg.text || "";
    const m = text.match(/^\/start(?:\s+u_([a-z0-9_]{3,24}))?/i);
    if (m && m[1]) {
      const u = m[1].toLowerCase();
      await tg("sendMessage", { chat_id: msg.chat.id, text: `Профиль перекупа @${u}. Открой, чтобы посмотреть его машины и подписаться.`, reply_markup: openBtn(`Открыть @${u}`, `#u-${u}`) });
    } else if (m) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Перекуп — твой гараж в Telegram.\n\n• Машины в наличии с фото и характеристиками\n• Учёт: покупка, ремонт, ценник, продажа и прибыль\n• Подписки на других перекупов и их публичные машины\n\nЖми кнопку, чтобы открыть.", reply_markup: openBtn("Открыть гараж") });
    } else {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Всё ведётся в приложении — открой гараж кнопкой ниже.", reply_markup: openBtn("Открыть гараж") });
    }
  } catch (e) {
    console.error(e);
  }
  return new Response("ok");
});
