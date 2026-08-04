import { build } from "vite";
import react from "@vitejs/plugin-react";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(here);
const dist = path.join(project, "dist");
const client = path.join(dist, "client");
const server = path.join(dist, "server");

await rm(dist, { recursive: true, force: true });

await build({
  root: here,
  configFile: false,
  plugins: [react()],
  build: {
    outDir: client,
    emptyOutDir: true,
    target: "es2022",
  },
});

await mkdir(server, { recursive: true });
await cp(path.join(here, "worker.js"), path.join(server, "index.js"));
await cp(path.join(project, "public", "og.png"), path.join(client, "og.png"));

const hosting = JSON.parse(await readFile(path.join(project, ".openai", "hosting.json"), "utf8"));
const wrangler = {
  name: "daymark",
  main: "index.js",
  compatibility_date: "2026-08-04",
  compatibility_flags: ["no_nodejs_compat"],
  d1_databases: hosting.d1
    ? [{
        binding: hosting.d1,
        database_name: "daymark-d1",
        database_id: "00000000-0000-4000-8000-000000000000",
      }]
    : [],
  assets: {
    directory: "../client",
    binding: "ASSETS",
    run_worker_first: true,
  },
};

await writeFile(path.join(server, "wrangler.json"), `${JSON.stringify(wrangler)}\n`);
await mkdir(path.join(dist, ".openai"), { recursive: true });
await cp(path.join(project, ".openai", "hosting.json"), path.join(dist, ".openai", "hosting.json"));
await cp(path.join(project, "drizzle"), path.join(dist, ".openai", "drizzle"), { recursive: true });
