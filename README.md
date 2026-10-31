# AdForge

> Actively developed and maintained with [OpenAI Codex](https://openai.com/codex/).

AdForge turns one product image and a short brief into multiple UGC-style ad variants, ranks the variants, and learns from real campaign results. It is designed for DTC and ecommerce teams that need systematic creative testing rather than a single generated asset.

## Highlights

- Produces multiple hooks, scripts, visual styles, and presenter variants.
- Runs locally without an API key using Edge TTS, FFmpeg, and Sharp.
- Supports optional Kling avatar and fal.ai video engines.
- Uses OpenAI for optional hook generation and predicted scoring.
- Accepts competitor ads or Winning Product Finder JSON as research evidence.
- Learns angle performance from impressions, clicks, conversions, and spend.
- Adds an AI-generated disclosure to local and avatar videos by default.
- Resumes interrupted campaigns without resubmitting completed paid jobs.

## Production engines

| Engine | Output | Estimated cost | Requirements |
|---|---|---:|---|
| `faceless` | Product B-roll, voiceover, karaoke captions | $0 | None |
| `avatar` | Photorealistic talking avatar with local voice and captions | ~$0.60–0.90/video | `FAL_KEY` |
| `veo` | Native generated video and audio | ~$1.20+/8 seconds | `FAL_KEY` |

Recommended workflow: validate many hooks with the free `faceless` engine, then produce the strongest one or two hooks with `avatar`.

## Pipeline

```text
RESEARCH  competitor ads or Winning Product Finder output -> proven angles
PLAN      brief and evidence -> distinct hooks and scripts
COMPOSE   product image -> visual scenes
ANIMATE   local FFmpeg/TTS or optional hosted video engine
SUBTITLE  synchronized karaoke captions
SCORE     heuristic or optional OpenAI scoring -> ranked variants
LEARN     real ad results -> winner and reusable angle weights
```

The learning priority is: real campaign evidence, competitor research evidence, then default angle weights. Variants below `LEARN_MIN_IMPRESSIONS` are excluded from learning to reduce small-sample bias.

## Quick start

Requirements: Node.js 18+ and FFmpeg.

```bash
npm install
npm test
npm start
```

Open <http://localhost:3000/app/>. The default local engine works without API keys.

For optional services:

```bash
cp .env.example .env
```

- `OPENAI_API_KEY`: OpenAI hook generation and predicted scoring.
- `FAL_KEY`: avatar and Veo/Seedance engines.
- `PLANNER_MODE`: `auto`, `template`, or `llm`.

## Research and learning APIs

- `POST /api/campaigns/:id/results`: save impressions, clicks, conversions, and spend.
- `GET /api/learnings`: return aggregated performance by psychological angle.

Competitor research can be plain text with one ad per line or Winning Product Finder JSON. Research is processed locally with deterministic Turkish and English pattern detection. When OpenAI is enabled, evidence is included as context without instructing the model to copy competitor text.

## Extension points

| Capability | Location |
|---|---|
| Visual styles | `lib/styles.js` |
| Presenter personas | `lib/avatars.js` |
| Production engines | `lib/engines/` |
| Scorers | `lib/scorers/` |
| Model and pricing registry | `lib/models.js` |
| Competitor research | `lib/research.js` |
| Campaign learning | `lib/learnings.js` |

## Operational notes

- API keys belong only in `.env`; never commit them.
- Paid generation is protected by a server-side spending limit.
- The application is intended for localhost by default. Add authentication and billing controls before a public deployment.
- `faceless` and `avatar` videos include an AI disclosure. Customize it with `AI_DISCLOSURE`; use `off` only after checking the applicable platform rules.
- If the repository is stored in OneDrive, keep `KEEP_TEMP=0` so intermediate rendering uses the system temporary directory.

See [DEPLOY.md](./DEPLOY.md) for deployment guidance and [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution rules.
