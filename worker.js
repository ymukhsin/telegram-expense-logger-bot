const GAS_WEB_APP_URL = "YOUR_GOOGLE_APPS_SCRIPT_EXEC_URL";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Pocket Ledger Relay is active.", { status: 200 });
    }

    const body = await request.text();

    ctx.waitUntil(
      fetch(GAS_WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        redirect: "follow"
      })
        .then((res) => res.text())
        .catch((err) => console.error("Relay error:", err))
    );

    return new Response("OK", { status: 200 });
  }
};