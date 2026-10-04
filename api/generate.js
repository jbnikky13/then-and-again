// THEN & AGAIN story engine. Three stages: bridge -> script -> production.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const SYSTEM = `You are the story engine for THEN & AGAIN, a short-form media brand: "Ancient problems. Modern solutions."
Chain: Biblical problem -> how it was addressed -> underlying principle -> modern problem -> modern solution -> closing question.
Tone: cinematic, intelligent, relatable, evidence-driven. Mini Netflix documentary. Never a sermon, never preachy.
HARD RULES:
1. Separate what the biblical text explicitly says from interpretation. Say "the same principle applies", never "the Bible predicted this".
2. Never present modern technology as literal prophecy. Treat biblical mechanisms as hypotheses.
3. Modern facts and stats must be real and sourced. If you cannot source a number, do not state it.
4. Respond with ONLY valid JSON. No markdown fences, no commentary.`;

async function claude(user, { search = false, max = 6000 } = {}) {
  // Gemini free tier. Thinking tokens count toward the limit, so allow headroom.
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: max * 2, temperature: 0.8 },
  };
  if (search) body.tools = [{ google_search: {} }];
  else body.generationConfig.responseMimeType = "application/json";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (r.status === 429) throw new Error("Free-tier rate limit hit. Wait a minute and try again.");
  if (!r.ok) throw new Error(d.error?.message || "Gemini API error");
  const c = d.candidates?.[0];
  const text = (c?.content?.parts || []).filter((x) => x.text).map((x) => x.text).join("");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0) throw new Error("Model returned no JSON (" + (c?.finishReason || "unknown") + "). Try again.");
  const out = JSON.parse(text.slice(s, e + 1));
  if (search) out._sources = (c?.groundingMetadata?.groundingChunks || []).map((g) => g.web?.title + " " + g.web?.uri).filter(Boolean).slice(0, 6);
  return out;
}

const STAGES = {
  bridge: ({ brief }) => claude(
    `STAGE 2 - MODERN BRIDGE. Use Google Search to find current, credible data on the modern problem below.
BRIEF: ${JSON.stringify(brief)}
Return JSON: {"modern_problem_title":"", "stats":[{"claim":"","source":"","url":""}], "mechanism":["3-4 short steps, ALL CAPS verbs, e.g. FORECAST"], "then_now":[{"then":"","now":""}], "modern_solution_concept":"", "counterpoint":"one honest limitation or criticism", "evidence_ok":true}
Need at least 2 sourced stats, else set evidence_ok=false.`, { search: true, max: 3500 }),

  script: ({ brief, bridge, seconds = 60 }) => claude(
    `STAGES 3-5 - STORY, SCRIPT, SCENE PLAN. Target length ${seconds}s vertical short (about ${Math.round(seconds * 2.5)} spoken words total).
BRIEF: ${JSON.stringify(brief)}
BRIDGE: ${JSON.stringify(bridge)}
Beats in order: HOOK, BIBLICAL PROBLEM, WHAT HAPPENED, BIBLICAL SOLUTION, UNDERLYING PRINCIPLE, MODERN PROBLEM, MODERN SOLUTION, QUESTION. One or two scenes per beat. The hook must open with a concrete, surprising line. Use at least one stat from the bridge (cite source name in the graphic).
Graphic types allowed: diagram, timeline, map, split_screen, stat_card, text_animation, visual_metaphor, none. Use the split_screen THEN/NOW table once. Alternate cinematic historical scenes and modern documentary visuals.
Return JSON: {"title":"", "hook":"", "scenes":[{"n":1,"beat":"HOOK","seconds":5,"voice":"","visual":"","graphic":{"type":"","content":""},"camera":"","sound":""}], "closing_question":""}`, { max: 5000 }),

  production: ({ scenes, title }) => claude(
    `STAGES 6-8 - PRODUCTION. Episode: "${title}". Scenes: ${JSON.stringify(scenes)}
For each scene write two separate prompts. Do NOT ask the video model to render text or diagrams (graphics are added in editing).
- flow_prompt: one rich cinematic paragraph for Google Flow, 9:16, 8s clip, subject, action, lighting, lens, mood.
- seedance_prompt: structured for Seedance: "Subject: / Action: / Camera: / Style: / Duration: / Aspect: 9:16".
Also: full voiceover text, and a social pack.
Return JSON: {"prompts":[{"n":1,"flow_prompt":"","seedance_prompt":""}], "voiceover":"", "social":{"youtube":{"title":"","description":""},"tiktok":{"caption":"","hashtags":[""]},"instagram":{"caption":"","hashtags":[""]}}}`, { max: 7000 }),
};

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not set" });
    const { stage, access, ...payload } = req.body || {};
    if (process.env.ACCESS_CODE && access !== process.env.ACCESS_CODE) return res.status(401).json({ error: "Wrong access code" });
    if (!STAGES[stage]) return res.status(400).json({ error: "Unknown stage" });
    res.status(200).json(await STAGES[stage](payload));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
