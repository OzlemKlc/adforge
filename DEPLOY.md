# Deployment

AdForge has two deployment targets:

| Component | Recommended target | Notes |
|---|---|---|
| Static landing page in `public/` | Vercel or Netlify | No persistent backend required |
| Application server and rendering pipeline | Railway, Render, or a local machine | Requires a persistent process and storage |

## Why the full application is not serverless

Video generation requires long-running polling, local files, background work after HTTP responses, and resumable job state. A short-lived serverless function cannot reliably provide those guarantees.

## Static landing page

1. Import the repository into Vercel.
2. Keep the framework preset as `Other`.
3. Use `public` as the output directory.
4. Point the landing-page application button to the Railway/Render URL or the local demo URL.

## Full application on Railway or Render

1. Import the GitHub repository.
2. Use `npm start` as the start command.
3. Add `FAL_KEY` and, optionally, `OPENAI_API_KEY`.
4. Attach persistent storage for `data/` so campaign history survives restarts.
5. Open the deployed `/app/` path.

Before exposing the application publicly, add authentication, request limits, spending controls, and secure persistent storage.
