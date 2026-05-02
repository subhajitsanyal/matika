# Matika Inference Platform

Owner: `inference-platform` agent (see `.agents/inference-platform.md`).

This directory holds prompt content, Guardrails configuration, escalation signal logic, and the model evaluation harness for Matika v2.

## Layout

```
inference-platform/
├── eval/                    # Vitest-based evaluation harness
│   ├── golden/              # Golden response fixtures
│   └── *.test.ts            # Evaluation suites (multilingual, code-switching, etc.)
├── prompts_dev/             # Development copies of prompts before promotion to backend/lambdas/*/prompts/
└── README.md
```

## Production prompts

The deployed prompts live in `backend/lambdas/bedrock-router/prompts/` and `backend/lambdas/bedrock-vision/prompts/`. Files there are owned by this agent; the surrounding Lambda code is owned by `backend`. See `AGENTS.md` for the shared-directory protocol.

## Running

```bash
npm install
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```
