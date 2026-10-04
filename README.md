# THEN & AGAIN Story Engine

Generates a full short-form episode (scenes, graphics plan, Flow + Seedance prompts, voiceover, social pack) from a Bible problem and its modern counterpart.

## Deploy (Vercel)
1. Import this repository in Vercel as a static/Other project (no framework, no build command). The root `index.html` is the frontend and `api/generate.js` is the serverless API route.
2. Add environment variables: `GEMINI_API_KEY` (required, free from aistudio.google.com), `ACCESS_CODE` (recommended, stops strangers using your key), `GEMINI_MODEL` (optional, default `gemini-flash-latest`).
3. Deploy. Open the URL, pick a topic, generate.

## Update topics
Replace `public/atlas.json` with fresh output from `python scripts/atlas_adapter.py master-atlas.md` (Problem Radar repo).
Pipeline: bridge (web-searched stats) -> script + scene plan -> prompts + social pack. Each stage is a separate API call to stay under Vercel's time limit.

## Free tier notes
Uses the Gemini API free tier (rate-limited; Google may use inputs/outputs to improve products; commercial use terms may apply, check Google AI Studio terms). If you see a 429, wait a minute.
