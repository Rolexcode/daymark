const schemaSql = `CREATE TABLE IF NOT EXISTS day_plans (
  date TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handlePlan(request, env) {
  if (!env.DB) return json({ error: "The habit database is unavailable." }, 500);
  await env.DB.prepare(schemaSql).run();

  if (request.method === "GET") {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!datePattern.test(date)) return json({ error: "A valid date is required." }, 400);
    const row = await env.DB.prepare("SELECT data FROM day_plans WHERE date = ?")
      .bind(date)
      .first();
    return json({ plan: row ? JSON.parse(row.data) : null });
  }

  if (request.method === "PUT") {
    const payload = await request.json();
    if (!payload.date || !datePattern.test(payload.date)) {
      return json({ error: "A valid date is required." }, 400);
    }
    if (!payload.plan || typeof payload.plan !== "object") {
      return json({ error: "A day plan is required." }, 400);
    }
    const encoded = JSON.stringify(payload.plan);
    if (encoded.length > 250000) return json({ error: "This day has too much content." }, 413);
    await env.DB.prepare(`INSERT INTO day_plans (date, data, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`)
      .bind(payload.date, encoded)
      .run();
    return json({ saved: true });
  }

  return json({ error: "Method not allowed." }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/plan") {
      try {
        return await handlePlan(request, env);
      } catch {
        return json({ error: "The day could not be saved or loaded." }, 500);
      }
    }

    if (url.pathname === "/") {
      const indexUrl = new URL("/index.html", url);
      const response = await env.ASSETS.fetch(new Request(indexUrl, request));
      const html = (await response.text()).replaceAll("__ORIGIN__", url.origin);
      return new Response(html, {
        status: response.status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
