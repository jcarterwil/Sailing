# Codex Cloud environment

Create the environment at https://chatgpt.com/codex/settings/environments with these settings:

- Repository: jcarterwil/Sailing
- Runtime: Node.js 22
- Setup script: bash scripts/codex-cloud-setup.sh
- Maintenance script: bash scripts/codex-cloud-maintenance.sh
- Agent internet access: disabled by default

Add these as environment variables for the full task:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- NEXT_PUBLIC_SITE_URL with the deployed application origin

Do not add SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_PASSWORD, or a
Vercel access token. Codex Cloud does not need production mutation or deployment credentials;
GitHub-connected Vercel deployments remain the release path.

Codex Cloud secrets are only available during setup and are removed before the agent phase, so
the public Supabase configuration belongs in environment variables rather than secrets.
