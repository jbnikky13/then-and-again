// THEN & AGAIN story engine.
// The API deliberately keeps Gemini calls server-side and uses a small number of
// requests so one episode does not burn through the project's rate limits.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MAX_RETRIES = 2;

const SYSTEM = `You are the story engine for THEN & AGAIN, a short-form media brand: "Ancient problems. Modern solutions."
Chain: Biblical problem -> how it was addressed -> underlying principle -> modern problem -> modern solution -> closing question.
Tone: cinematic, intelligent, relatable, evidence-driven. Mini Netflix documentary. Never a sermon, never preachy.
HARD RULES:
1. Separate what the biblical text explicitly says from interpretation. Say "the same principle applies", never "the Bible predicted this".
2. Never present modern technology as literal prophecy. Treat biblical mechanisms as hypotheses.
3. Modern facts and stats must be real and sourced. If you cannot source a number, do not state it.
4. Respond with ONLY valid JSON. No markdown fences, no commentary.`;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function parseRetryAfter(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : null;
}

function classifyGeminiError(status, data) {
  const message = data?.error?.message || "Gemini API error";
  const raw = JSON.stringify(data?.error || {}).toLowerCase();
  const daily = /daily|per day|quota_exceeded|generate.*requests.*day|requests.*day/.test(raw + message.toLowerCase());
  const rate = status === 429 && !daily;
  return {
    status,
    message,
    code: daily ? "QUOTA_EXHAUSTED" : rate ? "RATE_LIMITED" : status === 401 || status === 403 ? "AUTH_ERROR" : "GEMINI_ERROR",
    retryable: rate || status === 408 || status === 500 || status === 502 || status === 503 || status === 504,
  };
}

async function gemini(user, { search = false, maxOutputTokens = 4200 } = {}) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens,
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  };
  if (search) body.tools = [{ google_search: {} }];

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    const d = await r.json().catch(() => ({}));

    if (r.ok) {
      const c = d.candidates?.[0];
      const text = (c?.content?.parts || [])
        .filter(x => x.text)
        .map(x => x.text)
        .join("");
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      if (s < 0 || e <= s) {
        throw Object.assign(
          new Error("Gemini returned no usable JSON (" + (c?.finishReason || "unknown") + "). Try again."),
          { statusCode: 502, code: "BAD_MODEL_OUTPUT" }
        );
      }
      try {
        const out = JSON.parse(text.slice(s, e + 1));
        if (search) {
          out._sources = (c?.groundingMetadata?.groundingChunks || [])
            .map(g => g.web?.title + " " + g.web?.uri)
            .filter(Boolean)
            .slice(0, 6);
        }
        return out;
      } catch {
        throw Object.assign(new Error("Gemini returned malformed JSON. Try again."), {
          statusCode: 502,
          code: "BAD_MODEL_OUTPUT",
        });
      }
    }

    const info = classifyGeminiError(r.status, d);
    lastError = Object.assign(new Error(info.message), {
      statusCode: info.status,
      code: info.code,
      retryable: info.retryable,
    });

    if (!info.retryable || attempt === MAX_RETRIES) break;

    const retryAfter = parseRetryAfter(r.headers.get("retry-after"));
    const delay = retryAfter || Math.min(15000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
    await sleep(delay);
  }

  throw lastError;
}

const STAGES = {
  bridge: ({ brief }) => gemini(
    `STAGE 2 - MODERN BRIDGE. Use Google Search to find current, credible data on the modern problem below.
BRIEF: ${JSON.stringify(brief)}
Return JSON: {"modern_problem_title":"", "stats":[{"claim":"","source":"","url":""}], "mechanism":["3-4 short steps, ALL CAPS verbs"], "then_now":[{"then":"","now":""}], "modern_solution_concept":"", "counterpoint":"one honest limitation or criticism", "evidence_ok":true}
Need at least 2 sourced stats, else set evidence_ok=false.`,
    { search: true, maxOutputTokens: 2800 }
  ),

  story: ({ brief, bridge, seconds = 60 }) => gemini(
    `STAGES 3-8 - STORY, SCRIPT, SCENE PLAN, PRODUCTION. Target length ${seconds}s vertical short (about ${Math.round(seconds * 2.5)} spoken words total).
BRIEF: ${JSON.stringify(brief)}
BRIDGE: ${JSON.stringify(bridge)}
Beats in order: HOOK, BIBLICAL PROBLEM, WHAT HAPPENED, BIBLICAL SOLUTION, UNDERLYING PRINCIPLE, MODERN PROBLEM, MODERN SOLUTION, QUESTION. One or two scenes per beat.
The hook must open with a concrete, surprising line. Use at least one stat from the bridge and cite its source name in the graphic.
Graphic types allowed: diagram, timeline, map, split_screen, stat_card, text_animation, visual_metaphor, none. Use the split_screen THEN/NOW table once. Alternate cinematic historical scenes and modern documentary visuals.
For each scene write two separate production prompts. Do NOT ask the video model to render text or diagrams.
flow_prompt: one rich cinematic paragraph for Google Flow, 9:16, 8s clip, subject, action, lighting, lens, mood.
seedance_prompt: "Subject: / Action: / Camera: / Style: / Duration: / Aspect: 9:16".
Return ONLY this JSON shape:
{"title":"","hook":"","scenes":[{"n":1,"beat":"HOOK","seconds":5,"voice":"","visual":"","graphic":{"type":"","content":""},"camera":"","sound":""}],"closing_question":"","prompts":[{"n":1,"flow_prompt":"","seedance_prompt":""}],"voiceover":"","social":{"youtube":{"title":"","description":""},"tiktok":{"caption":"","hashtags":[""]},"instagram":{"caption":"","hashtags":[""]}}}`,
    { maxOutputTokens: 6500 }
  ),
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not set", code: "CONFIG_ERROR" });

    const { stage, access, ...payload } = req.body || {};
    if (process.env.ACCESS_CODE && access !== process.env.ACCESS_CODE) {
      return res.status(401).json({ error: "Wrong access code", code: "ACCESS_DENIED" });
    }
    if (!STAGES[stage]) return res.status(400).json({ error: "Unknown stage", code: "BAD_STAGE" });

    const result = await STAGES[stage](payload);
    return res.status(200).json(result);
  } catch (e) {
    const status = e.statusCode || 500;
    const code = e.code || "SERVER_ERROR";
    return res.status(status).json({
      error: e.message || "Generation failed",
      code,
      retryable: Boolean(e.retryable),
      model: MODEL,
    });
  }
};
