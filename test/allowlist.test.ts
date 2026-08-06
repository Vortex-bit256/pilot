import assert from "node:assert/strict";
import { test } from "node:test";
import type { LLMResponse } from "../src/core/llm/provider.js";
import { FakeProvider, makeAgent, runToEnd, spyTool } from "./fakes.js";


function twoTaskScript(): LLMResponse[] {
  return [
    { toolCalls: [{ id: "1", name: "write_thing", input: {} }], stopReason: "tool_calls" },
    { text: "first done", toolCalls: [], stopReason: "stop" },
    { toolCalls: [{ id: "2", name: "write_thing", input: {} }], stopReason: "tool_calls" },
    { text: "second done", toolCalls: [], stopReason: "stop" },
  ];
}

test('"always" allows the tool for the rest of the session', async () => {
  const counter = { count: 0 };
  let asked = 0;
  const provider = new FakeProvider(twoTaskScript());
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  agent.setApprovalHandler(async () => {
    asked++;
    return "always";
  });

  await runToEnd(agent, "first task");
  await runToEnd(agent, "second task");

  assert.equal(asked, 1, "asked once, then remembered");
  assert.equal(counter.count, 2, "both writes executed");
});

test('"allow" (once) keeps asking next time', async () => {
  const counter = { count: 0 };
  let asked = 0;
  const provider = new FakeProvider(twoTaskScript());
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  agent.setApprovalHandler(async () => {
    asked++;
    return "allow";
  });

  await runToEnd(agent, "first task");
  await runToEnd(agent, "second task");

  assert.equal(asked, 2, "a plain allow is not remembered");
  assert.equal(counter.count, 2);
});
