# Deployment

Sentinel Memory needs exactly two external services: a CockroachDB Cloud cluster
and Bedrock model access. No queue, no cache, no separate vector database, no
container orchestration.

---

## 1. CockroachDB Cloud

1. Create a cluster at https://cockroachlabs.cloud (Serverless/Basic is enough
   for a demo).
2. Create a database — `sentinel` — and a SQL user for the application.
3. **Cluster → Connect → General connection string.** It looks like:
   ```
   postgresql://USER:PASSWORD@HOST:26257/sentinel?sslmode=verify-full
   ```
4. Check the cluster version. Vector indexes need **v25.2+**:
   - **v25.2** — preview, requires
     `SET CLUSTER SETTING feature.vector_index.enabled = true;`
   - **v25.3+** — GA.

   `scripts/migrate.ts` attempts the setting automatically and degrades
   gracefully if the index cannot be created.

## 2. Amazon Bedrock

1. Pick a region where the models you want are available, e.g. `us-east-1`.
2. **Bedrock console → Model access** → request access to a text model and, if
   you want real embeddings, an embedding model. Approval is usually immediate.
3. Confirm what you can actually call:
   ```bash
   aws bedrock list-foundation-models --region us-east-1 \
     --query 'modelSummaries[].modelId' --output table
   ```
4. Create an IAM principal for the app with a minimal policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["bedrock:InvokeModel", "bedrock:Converse"],
       "Resource": [
         "arn:aws:bedrock:us-east-1::foundation-model/YOUR_TEXT_MODEL_ID",
         "arn:aws:bedrock:us-east-1::foundation-model/YOUR_EMBEDDING_MODEL_ID"
       ]
     }]
   }
   ```

   Prefer a role over static keys wherever the platform supports it — the app
   uses the default AWS provider chain when `AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY` are absent, so a role works with no code change.

## 3. Migrate and seed (once, before the first deploy)

Run from your machine against the production cluster:

```bash
export DATABASE_URL='postgresql://…'
export BEDROCK_EMBEDDING_MODEL_ID='amazon.titan-embed-text-v2:0'
export AWS_REGION='us-east-1'
export EMBEDDING_DIMENSIONS=1024

npm run db:migrate
npm run db:seed
```

Seed with the **same** embedding model the deployment will use. Mixing vectors
from different models in one column makes distances meaningless. If you change
models later, re-run `npm run db:migrate -- --drop && npm run db:seed`.

The seeder ends with a retrieval smoke test — confirm the Machine 7 query returns
`INC-2025-0412` before deploying.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel                    # link the project
```

Set environment variables in **Project → Settings → Environment Variables** for
both Production and Preview:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | your CockroachDB connection string |
| `AWS_REGION` | e.g. `us-east-1` |
| `BEDROCK_MODEL_ID` | your text model id |
| `BEDROCK_EMBEDDING_MODEL_ID` | your embedding model id |
| `AWS_ACCESS_KEY_ID` | if not using a role |
| `AWS_SECRET_ACCESS_KEY` | if not using a role |
| `EMBEDDING_DIMENSIONS` | must match the embedding model |
| `DEMO_MODE` | `true` for the hackathon demo |
| `DEFAULT_RESPONDER` | e.g. `A. Reyes (Shift Lead)` |

Then:

```bash
vercel --prod
curl -s https://YOUR-APP.vercel.app/api/health | jq '.mode, .notices'
```

`mode` should read `cockroachdb` / `bedrock` / `bedrock`, and `notices` should be
empty. If it isn't, the notices say exactly what is missing.

**Vercel notes**

- Routes that call Bedrock declare `maxDuration = 60`. Hobby-plan function
  timeouts are shorter; if you see truncated requests, upgrade the plan or reduce
  `maxTokens` in `src/lib/ai/reasoner.ts`.
- `serverExternalPackages: ['pg']` keeps the driver out of the bundle — already
  configured in `next.config.ts`.
- Serverless instances each hold their own pool (`max: 8`). Keep an eye on the
  cluster's connection limit if you scale wide; lower `max` in
  `src/lib/db/client.ts` if needed.
- Rate limiting is per-instance and in-memory. It is a courtesy limit, not a
  security control, in a multi-instance deployment.

## Deploy anywhere else

Any Node 20+ host works:

```bash
npm ci
npm run build
npm start          # defaults to PORT 3000
```

Docker, if you want it:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

Pass secrets as environment variables from your platform's secret manager. Never
bake them into the image.

---

## Post-deploy checklist

- [ ] `/api/health` → `status: "ok"`, `notices: []`
- [ ] `mode.store` is `cockroachdb` (not `in-memory-demo`)
- [ ] `mode.reasoning` and `mode.embeddings` are `bedrock`
- [ ] `database.vectorIndexPresent` is `true` (or you have accepted exact scan)
- [ ] `/api/seed` → `seeded: true`
- [ ] The Command Center loads with the counterfactual card populated
- [ ] Adding an observation produces a recommendation citing memory IDs
- [ ] Approving returns `transaction.atomic: true`
- [ ] The timeline shows the decision and the state change
- [ ] A handoff generates and stores a briefing
- [ ] `curl -s https://YOUR-APP/ | grep -i 'AKIA\|secretAccess\|postgresql://'` finds nothing

## Operating notes

- **Backups.** CockroachDB Cloud takes managed backups. The memory tables are the
  product; verify the retention policy matches how long you need incident
  history.
- **Monitoring.** Poll `/api/health` — a non-empty `notices` array means
  something is degraded. `application_name=sentinel-memory` is set on every
  connection, so cluster-side query attribution works.
- **Cost.** Bedrock is charged per invocation. Each observation triggers one
  embedding call and one text call; each page load of the Command Center triggers
  one embedding call for the initial retrieval. An embedding cache is on the
  hardening roadmap.
- **Rotation.** The application's `DATABASE_URL` and the read-only MCP
  service-account key are separate credentials with different lifecycles. Rotate
  independently.
