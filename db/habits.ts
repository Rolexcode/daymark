import { env } from "cloudflare:workers";

const schemaSql = `CREATE TABLE IF NOT EXISTS day_plans (
  date TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function database() {
  if (!env.DB) throw new Error("The habit database is unavailable.");
  await env.DB.prepare(schemaSql).run();
  return env.DB;
}

export async function readDayPlan(date: string) {
  const db = await database();
  return db.prepare("SELECT data FROM day_plans WHERE date = ?").bind(date).first<{ data: string }>();
}

export async function writeDayPlan(date: string, data: string) {
  const db = await database();
  return db
    .prepare(`INSERT INTO day_plans (date, data, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`)
    .bind(date, data)
    .run();
}
