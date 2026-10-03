# Post-deployment smoke tests (item 75)

**NEBU production smoke** runs automatically after any of this repository's three
existing Pages deployment workflows succeeds on `main`. Failed deployments and
other branches are ignored. It checks out the deployed commit and performs only
GET requests; it never deploys, logs in, calls OAuth callbacks or sends bot commands.
Its token has only read permission and checkout does not persist credentials.

Default target: `https://nebu.quest/` (the repository's CNAME). If using the default
Pages domain, set repository variable `PRODUCTION_SITE_URL` to
`https://friskydevelopments.github.io/NEBU-/`. Only those two NEBU targets are allowed;
credentials, query strings, fragments, alternate ports and redirects are rejected.

The four checks require HTTP 200, expected content type and recognizable content
for the root document, documentation, SVG favicon and custom 404 document. These
detect server errors, missing assets and unrelated/login/soft-404 responses. Each
request times out after 15 seconds and retries at most three times to accommodate
brief propagation delays. Response bodies and URLs are not logged or uploaded.

Verify the harness offline with `npm test`. It tests repository content, transient
failure recovery, bounded retries, incorrect status/content and unsafe targets with
mocked fetches. After an authorized deployment, inspect **NEBU production smoke**
in Actions; a failed smoke run marks that check failed but does not roll back or
redeploy. A manual read-only run is also available on `main`:

```sh
node scripts/production-smoke.cjs
```

Scope is the deployed Pages site. It does not claim bot/Zoom API readiness or prove
which revision a CDN serves; no revision endpoint currently exists. No deployment
or production smoke request is needed to run the PR tests.
