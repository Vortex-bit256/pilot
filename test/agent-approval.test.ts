import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalHandler } from "../src/core/agent/permissions.js";
import type { ApprovalRequest } from "../src/protocol/index.js";
import {
  FakeProvider,
  lastMessage,
  makeAgent,
  runToEnd,
  scriptFor,
  spyTool,
} from "./fakes.js";

test("safe mode: a write tool runs only after an explicit allow", async () => {
  const counter = { count: 0 };
  const requests: ApprovalRequest[] = [];
  const provider = new FakeProvider(scriptFor({ id: "1", name: "write_thing", input: {} }));
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  const handler: ApprovalHandler = async (request) => {
    requests.push(request);
    return "allow";
  };
  agent.setApprovalHandler(handler);

  const { events } = await runToEnd(agent, "do the thing");

  assert.equal(counter.count, 1, "tool should have executed");
  assert.equal(requests.length, 1, "handler should have been asked once");
  assert.equal(requests[0].kind, "write");
  assert.equal(requests[0].call.name, "write_thing");
  const result = events.find((e) => e.type === "tool_result");
  assert.ok(result && result.type === "tool_result" && !result.result.isError);
});

test("safe mode: a denial reaches the model and the tool never runs", async () => {
  const counter = { count: 0 };
  const provider = new FakeProvider(scriptFor({ id: "1", name: "write_thing", input: {} }));
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  agent.setApprovalHandler(async () => "deny");

  const { events } = await runToEnd(agent, "do the thing");

  assert.equal(counter.count, 0, "denied tool must not execute");
  const result = events.find((e) => e.type === "tool_result");
  assert.ok(result && result.type === "tool_result" && result.result.isError);
  const toolMessage = lastMessage(provider);
  assert.equal(toolMessage.role, "tool");
  assert.match(toolMessage.content, /denied/i);
});

test("safe mode: read tools never trigger the approval channel", async () => {
  const counter = { count: 0 };
  let asked = 0;
  const provider = new FakeProvider(scriptFor({ id: "1", name: "read_thing", input: {} }));
  const agent = makeAgent("safe", provider, [spyTool("read_thing", "read", counter)]);
  agent.setApprovalHandler(async () => {
    asked++;
    return "allow";
  });

  await runToEnd(agent, "look at the thing");

  assert.equal(counter.count, 1);
  assert.equal(asked, 0, "read tools must not require approval");
});

test("work mode: writes are free, exec still asks", async () => {
  const writeCounter = { count: 0 };
  const execCounter = { count: 0 };
  const askedAbout: string[] = [];
  const provider = new FakeProvider([
    { toolCalls: [{ id: "1", name: "write_thing", input: {} }], stopReason: "tool_calls" },
    { toolCalls: [{ id: "2", name: "exec_thing", input: {} }], stopReason: "tool_calls" },
    { text: "done", toolCalls: [], stopReason: "stop" },
  ]);
  const agent = makeAgent("work", provider, [
    spyTool("write_thing", "write", writeCounter),
    spyTool("exec_thing", "exec", execCounter),
  ]);
  agent.setApprovalHandler(async ({ call }) => {
    askedAbout.push(call.name);
    return "allow";
  });

  await runToEnd(agent, "write then run");

  assert.equal(writeCounter.count, 1);
  assert.equal(execCounter.count, 1);
  assert.deepEqual(askedAbout, ["exec_thing"], "only the exec call should need approval");
});

test("free mode: nothing is ever asked", async () => {
  const counter = { count: 0 };
  let asked = 0;
  const provider = new FakeProvider(scriptFor({ id: "1", name: "exec_thing", input: {} }));
  const agent = makeAgent("free", provider, [spyTool("exec_thing", "exec", counter)]);
  agent.setApprovalHandler(async () => {
    asked++;
    return "allow";
  });

  await runToEnd(agent, "run it");

  assert.equal(counter.count, 1);
  assert.equal(asked, 0);
});

test("non-interactive policy: no handler means auto-deny", async () => {
  const counter = { count: 0 };
  const provider = new FakeProvider(scriptFor({ id: "1", name: "write_thing", input: {} }));
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);


  await runToEnd(agent, "do the thing");

  assert.equal(counter.count, 0, "without an approval channel the call must be denied");
  assert.match(lastMessage(provider).content, /no approval channel/i);
});

test("setPermissionMode switches the policy at runtime", async () => {
  const counter = { count: 0 };
  let asked = 0;
  const provider = new FakeProvider([

    { toolCalls: [{ id: "1", name: "write_thing", input: {} }], stopReason: "tool_calls" },
    { text: "first done", toolCalls: [], stopReason: "stop" },

    { toolCalls: [{ id: "2", name: "write_thing", input: {} }], stopReason: "tool_calls" },
    { text: "second done", toolCalls: [], stopReason: "stop" },
  ]);
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  agent.setApprovalHandler(async () => {
    asked++;
    return "allow";
  });

  await runToEnd(agent, "first task");
  assert.equal(asked, 1, "safe mode should ask for the first write");

  agent.setPermissionMode("free");
  await runToEnd(agent, "second task");
  assert.equal(asked, 1, "free mode should not ask again");
  assert.equal(counter.count, 2);
});

test("a throwing approval handler fails safe: the call is denied", async () => {
  const counter = { count: 0 };
  const provider = new FakeProvider(scriptFor({ id: "1", name: "write_thing", input: {} }));
  const agent = makeAgent("safe", provider, [spyTool("write_thing", "write", counter)]);
  agent.setApprovalHandler(async () => {
    throw new Error("UI blew up");
  });

  await runToEnd(agent, "do the thing");

  assert.equal(counter.count, 0, "a broken approval channel must never allow execution");
  assert.match(lastMessage(provider).content, /denied/i);
});
