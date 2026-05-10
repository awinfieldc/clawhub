/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleEvalUserMessage, type SkillEvalContext } from "./lib/securityPrompt";
import { backfillLlmEval, packageOpenClawEnvironmentForPrompt } from "./llmEval";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type BackfillArgs = {
  cursor?: number;
  batchSize?: number;
  delayMs?: number;
  dryRun?: boolean;
  maxToSchedule?: number;
  moderationMode?: "normal" | "preserve";
  accTotal?: number;
  accScheduled?: number;
  accSkipped?: number;
  startTime?: number;
};

const backfillLlmEvalHandler = (
  backfillLlmEval as unknown as WrappedHandler<BackfillArgs, Record<string, unknown>>
)._handler;

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  }
  vi.restoreAllMocks();
});

function makeBackfillCtx(batch: {
  skills: Array<{ versionId: string; slug: string }>;
  nextCursor: number;
  done: boolean;
}) {
  const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
    if ("cursor" in args || "batchSize" in args) return batch;
    if ("versionId" in args) return { _id: args.versionId, skillId: "skills:1" };
    throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
  });
  const runAfter = vi.fn(async () => undefined);

  return {
    ctx: {
      runQuery,
      scheduler: { runAfter },
    },
    runQuery,
    runAfter,
  };
}

describe("llm eval backfill", () => {
  it("passes preserve moderation mode to scheduled evaluations and follow-up batches", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const { ctx, runQuery, runAfter } = makeBackfillCtx({
      skills: [{ versionId: "skillVersions:1", slug: "demo" }],
      nextCursor: 42,
      done: false,
    });

    const result = await backfillLlmEvalHandler(ctx, {
      batchSize: 5,
      delayMs: 1234,
      moderationMode: "preserve",
      startTime: 1_700_000_000_000,
    });

    expect(runQuery.mock.calls[0]?.[1]).toEqual({ cursor: 0, batchSize: 5 });
    expect(runAfter).toHaveBeenNthCalledWith(1, 0, expect.anything(), {
      versionId: "skillVersions:1",
      moderationMode: "preserve",
    });
    expect(runAfter).toHaveBeenNthCalledWith(2, 1234, expect.anything(), {
      cursor: 42,
      batchSize: 5,
      delayMs: 1234,
      moderationMode: "preserve",
      accTotal: 1,
      accScheduled: 1,
      accSkipped: 0,
      startTime: 1_700_000_000_000,
    });
    expect(result).toEqual({ status: "continuing", totalSoFar: 1 });
  });

  it("can dry run without an OpenAI key or scheduled actions", async () => {
    delete process.env.OPENAI_API_KEY;
    const { ctx, runAfter } = makeBackfillCtx({
      skills: [{ versionId: "skillVersions:1", slug: "demo" }],
      nextCursor: 42,
      done: false,
    });

    const result = await backfillLlmEvalHandler(ctx, {
      batchSize: 1,
      dryRun: true,
      moderationMode: "preserve",
      startTime: 1_700_000_000_000,
    });

    expect(runAfter).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "dry_run",
      total: 1,
      scheduled: 1,
      skipped: 0,
      nextCursor: 42,
      done: false,
      moderationMode: "preserve",
    });
  });
});

describe("package LLM eval metadata", () => {
  it("maps package openclaw.environment declarations into prompt requirements", () => {
    const openclawMetadata = packageOpenClawEnvironmentForPrompt({
      openclaw: {
        environment: {
          requiredEnv: ["MODEL_GATEWAY_TOKEN"],
          optionalEnv: ["OPENAI_API_KEY", "<PROVIDER>_API_KEY", "<PROVIDER>_TOKEN"],
          envVars: [{ name: "ANTHROPIC_API_KEY", required: false, description: "Claude access" }],
          configPaths: ["~/.openclaw/agents/main/agent/models.json"],
          primaryEnv: "MODEL_GATEWAY_TOKEN",
          credentialSources: ["OpenClaw runtime auth resolver"],
          recommendedMode: "modelSource=gateway",
        },
      },
    });

    expect(openclawMetadata).toEqual({
      requires: {
        env: ["MODEL_GATEWAY_TOKEN"],
        config: ["~/.openclaw/agents/main/agent/models.json"],
      },
      envVars: [
        { name: "MODEL_GATEWAY_TOKEN", required: true },
        { name: "OPENAI_API_KEY", required: false },
        { name: "<PROVIDER>_API_KEY", required: false },
        { name: "<PROVIDER>_TOKEN", required: false },
        { name: "ANTHROPIC_API_KEY", required: false, description: "Claude access" },
      ],
      primaryEnv: "MODEL_GATEWAY_TOKEN",
    });

    const message = assembleEvalUserMessage({
      slug: "@remnic/plugin-openclaw",
      displayName: "OpenClaw Plugin",
      ownerUserId: "users:1",
      version: "1.0.33",
      createdAt: Date.UTC(2026, 4, 1),
      summary: "Routes model calls through configured providers.",
      source: "https://github.com/remnic/plugin-openclaw",
      homepage: undefined,
      parsed: {
        frontmatter: {},
        metadata: { openclaw: openclawMetadata },
      },
      files: [{ path: "package.json", size: 1200 }],
      skillMdContent: '{"name":"@remnic/plugin-openclaw"}',
      fileContents: [],
      injectionSignals: [],
    } satisfies SkillEvalContext);

    expect(message).toContain("Required env vars: MODEL_GATEWAY_TOKEN");
    expect(message).toContain("OPENAI_API_KEY (optional)");
    expect(message).toContain("ANTHROPIC_API_KEY (optional) - Claude access");
    expect(message).toContain("Primary credential: MODEL_GATEWAY_TOKEN");
    expect(message).toContain("Required config paths: ~/.openclaw/agents/main/agent/models.json");
    expect(message).not.toContain("OpenClaw runtime auth resolver");
    expect(message).not.toContain("modelSource=gateway");
  });
});
