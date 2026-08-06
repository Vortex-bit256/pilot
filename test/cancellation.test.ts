import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCELLED_ANSWER } from "../src/core/agent/agent.js";
import type {
  ChatParams,
  LLMProvider,
  LLMResponse,
  ModelCapabilities,
} from "../src/core/llm/provider.js";
import { FakeProvider, makeAgent, runToEnd, scriptFor, spyTool } from "./fakes.js";


class HangingProvider implements LLMProvider {
  readonly id = "hanging";

  capabilities(): ModelCapabilities {
    return { streaming: false, toolCalling: true, reasoning: false };
  }

  chat(params: ChatParams): Promise<LLMResponse> {
    return new Promise((_, reject) => {
      params.signal?.addEventListener("abort", () => reject(new Error("Request was aborted.")), {
        once: true,
      });
    });
  }
}

test("aborting a stuck LLM call ends the task with a cancelled event", async () => {
  const controller = new AbortController();
  const agent = makeAgent("free", new HangingProvider(), []);

  const pending = runToEnd(agent, "never answers", controller.signal);
  setTimeout(() => controller.abort(), 10);
  const { events, answer } = await pending;

  assert.equal(answer, CANCELLED_ANSWER);
  assert.deepEqual(
    events.map((e) => e.type),
    ["cancelled"],
  );
});

test("aborting before the loop starts cancels immediately", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = new FakeProvider(scriptFor({ id: "1", name: "write_thing", input: {} }));
  const agent = makeAgent("free", provider, [spyTool("write_thing", "write", { count: 0 })]);

  const { events, answer } = await runToEnd(agent, "too late", controller.signal);

  assert.equal(answer, CANCELLED_ANSWER);
  assert.deepEqual(
    events.map((e) => e.type),
    ["cancelled"],
  );
  assert.equal(provider.calls.length, 0, "the LLM must not be called after an abort");
});

test("aborting mid-tool skips remaining tools and backfills history", async () => {
  const controller = new AbortController();
  const t1 = { count: 0 };
  const t2 = { count: 0 };
  const provider = new FakeProvider([
    {
      toolCalls: [
        { id: "1", name: "t1", input: {} },
        { id: "2", name: "t2", input: {} },
      ],
      stopReason: "tool_calls",
    },

    { text: "all good", toolCalls: [], stopReason: "stop" },
  ]);
  const agent = makeAgent("free", provider, [
    spyTool("t1", "exec", t1, () => controller.abort()),
    spyTool("t2", "exec", t2),
  ]);

  const { events } = await runToEnd(agent, "run both", controller.signal);

  assert.deepEqual(
    events.map((e) => e.type),
    ["tool_call", "cancelled"],
    "t1's result is dropped once the abort lands mid-flight",
  );
  assert.equal(t1.count, 1);
  assert.equal(t2.count, 0, "t2 must not run after the abort");


  await runToEnd(agent, "next task");
  const messages = provider.calls.at(-1)?.messages ?? [];
  const withCalls = messages.find((m) => m.role === "assistant" && m.toolCalls?.length);
  assert.ok(withCalls?.toolCalls, "expected the recorded history to contain the tool calls");
  const answered = new Set(
    messages.filter((m) => m.role === "tool").map((m) => m.toolCallId),
  );
  for (const call of withCalls.toolCalls) {
    assert.ok(answered.has(call.id), `dangling tool call ${call.id} in history`);
  }
});

test("aborting while the approval prompt is open cancels the task", async () => {
  const controller = new AbortController();
  const counter = { count: 0 };
  const provider = new FakeProvider(scriptFor({ id: "1", name: "write_thing", input: {} }));
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  agent.setApprovalHandler(async (request) => {

    assert.equal(request.signal, controller.signal);
    controller.abort();
    return "deny";
  });

  const { events } = await runToEnd(agent, "do it", controller.signal);

  assert.equal(counter.count, 0);
  assert.deepEqual(
    events.map((e) => e.type),
    ["tool_call", "cancelled"],
  );
});
