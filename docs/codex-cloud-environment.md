# Codex Cloud environment

Create the environment at https://chatgpt.com/codex/settings/environments with these settings:

- Repository: jcarterwil/Sailing
- Runtime: Node.js 24
- Setup script: bash scripts/codex-cloud-setup.sh
- Maintenance script: bash scripts/codex-cloud-maintenance.sh
- Agent internet access: disabled by default

## Don't build/test in the sandbox — let CI do it

The Codex Cloud sandbox is resource-constrained and unreliable for a full
`npm run build` / test run. **Do not run `npm run verify` (or `npm run build`)
here to validate a change.** Run only the fast, cheap checks when you need local
signal — `npm run lint` and `npm run typecheck` (the setup script already runs
typecheck), plus targeted `npm run test` cases if they're relevant.

The authoritative build/test is **GitHub CI** (`.github/workflows/ci.yml`), which
runs `npm run verify` on every PR. Open the PR and let CI build and test; fix
whatever it flags. Chasing a green build inside the sandbox wastes the run and
often fails for environment reasons rather than real defects.

Add these as environment variables for the full task:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- NEXT_PUBLIC_SITE_URL with the deployed application origin

Do not add SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_PASSWORD, or a
Vercel access token. Codex Cloud does not need production mutation or deployment credentials;
GitHub-connected Vercel deployments remain the release path.

Codex Cloud secrets are only available during setup and are removed before the agent phase, so
the public Supabase configuration belongs in environment variables rather than secrets.
