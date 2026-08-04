import { readDayPlan, writeDayPlan } from "../../../db/habits";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!datePattern.test(date)) {
      return Response.json({ error: "A valid date is required." }, { status: 400 });
    }
    const row = await readDayPlan(date);
    return Response.json({ plan: row ? JSON.parse(row.data) : null });
  } catch {
    return Response.json({ error: "The day could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as { date?: string; plan?: unknown };
    if (!payload.date || !datePattern.test(payload.date)) {
      return Response.json({ error: "A valid date is required." }, { status: 400 });
    }
    if (!payload.plan || typeof payload.plan !== "object") {
      return Response.json({ error: "A day plan is required." }, { status: 400 });
    }
    const encoded = JSON.stringify(payload.plan);
    if (encoded.length > 250_000) {
      return Response.json({ error: "This day has too much content." }, { status: 413 });
    }
    await writeDayPlan(payload.date, encoded);
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: "The day could not be saved." }, { status: 500 });
  }
}
