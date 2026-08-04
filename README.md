# Daymark

Daymark is a private, browser-based daily habit tracker. Plan tomorrow with time blocks and small steps, check off the day, and finish with an evening review.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import `Rolexcode/daymark` in Vercel and keep the detected Vite defaults:

- Build command: `npm run build`
- Output directory: `dist`

Habit data is stored in the browser with `localStorage`. It survives reloads on the same browser and device, but it is not synced between devices.
