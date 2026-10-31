# Workflow Builder

A drag-and-drop workflow builder: design workflows in a React Flow canvas,
run them on Temporal, and watch each node execute live.

Node types: Trigger, Set Variable, If, For Each, Repeat, While, Code (JavaScript),
HTTP Request, Delay, Log, Return.

## How it fits together

```
web/ (Next.js + React Flow)          shared/ (@app/shared)            worker/ (Temporal worker)
  editor  -> saves graph JSON          dsl.ts      node types/schemas    interpretWorkflow: walks the DSL
  API     -> compiles + starts run     compile.ts  graph -> DSL          activities: httpRequest, runCode
          -> polls getProgress query   expr.ts     safe expressions
        |                                                                 |
     Postgres (workflows, runs)                      Temporal dev server  |
```

- The editor saves the raw React Flow graph to Postgres.
- On Run, the API compiles the graph into a DSL (validated, UI data stripped)
  and starts **one generic workflow**, `interpretWorkflow`, with the DSL as input.
- The worker interprets the DSL. Expressions are evaluated inside the workflow by a
  small deterministic evaluator; user code and HTTP calls run as activities.
- The UI polls the run; the API reads status from Temporal and node progress
  through the workflow's `getProgress` query. Temporal is the source of truth.

## Running locally

Prerequisites: Node 24, Docker (Postgres), the Temporal CLI.

```sh
npm install                      # once, at the repo root (npm workspaces)

# 1. Postgres (docker) with a database named workflow_builder
# 2. Temporal dev server, state kept in temporal.db
temporal server start-dev --db-filename temporal.db

npm run db:migrate               # create tables
npm run dev:worker               # terminal 3: the Temporal worker (watch mode)
npm run dev:web                  # terminal 4: http://localhost:3000
```

Configuration lives in the root `.env` (shared by web and worker):

```
DATABASE_URL=postgresql://admin:password@localhost:5432/workflow_builder
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=workflow-builder
# optional: TEMPORAL_UI_URL=http://localhost:8233
```

On the home page, **Add example workflows** creates three demos. Try the
"Durable delay" one: run it, stop the worker during the 20s delay, start it
again, and the run picks up where it left off.

## Expressions and templates

Conditions, Set Variable values, loop lists and Return values are expressions,
a safe JavaScript subset: `total + 1`, `input.users[0].name`, `n % 2 == 0 && n > 2`,
`{ total, count: len(items) }`. Functions: `len upper lower trim split join includes
slice keys values range sum min max round floor ceil abs number string bool json
parseJson typeOf`. `x ?? 0` works even before `x` is set.

HTTP URL/headers/body and Log messages are templates: `Hello {{ user.name }}`.
A body that is a single `{{ expression }}` is sent as JSON.

## Limits and caveats

- **Code nodes use `node:vm`, which is not a security sandbox.** Fine for a local demo;
  use isolated-vm, QuickJS or a container before accepting code from other people.
- One connection per output: no parallel branches yet.
- Loops are capped by `maxIterations` (max 1000) and a run by 10,000 steps, to stay
  well under Temporal's event-history limits.
- No auth.

## Tests

```sh
npm test            # shared unit tests + worker integration tests (time-skipping Temporal)
npm run typecheck
```
