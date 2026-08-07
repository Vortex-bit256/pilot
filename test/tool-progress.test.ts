


import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { runCommandTool } from "../src/core/tools/builtin/runCommand.js";
import type { ToolCall, ToolProgress } from "../src/protocol/index.js";
import { FakeProvider, makeAgent, runToEnd, scriptFor } from "./fakes.js";

test("run_command streams output lines via onProgress while running", async () => {
  const reports: ToolProgress[] = [];
  const result = await runCommandTool.execute(
    { command: "printf 'one\\ntwo\\nthree\\n'" },
    { cwd: process.cwd(), onProgress: (p) => reports.push(p) },
  );

  assert.equal(result.isError, undefined);
  assert.equal(result.content, "one\ntwo\nthree");
  assert.ok(reports.length > 0, "expected at least one progress report");


  const streamed = reports.flatMap((p) => p.output ?? []);
  assert.deepEqual(streamed, ["one", "two", "three"]);


  for (const report of reports) {
    assert.equal(report.stage, "run");
    assert.match(report.label, /running for \d+s/);
    assert.equal(typeof report.elapsed, "number");
  }
});

test("run_command reports stderr lines too and keeps a non-zero exit as an error", async () => {
  const reports: ToolProgress[] = [];
  const result = await runCommandTool.execute(
    { command: "echo oops >&2; exit 3" },
    { cwd: process.cwd(), onProgress: (p) => reports.push(p) },
  );

  assert.equal(result.isError, true);
  assert.match(result.content, /code 3/);
  assert.match(result.content, /oops/);
  assert.ok(
    reports.flatMap((p) => p.output ?? []).includes("oops"),
    "expected the stderr line in the progress stream",
  );
});

test("the agent loop forwards tool_progress between tool_call and tool_result", async () => {
  const call: ToolCall = { id: "c1", name: "run_command", input: { command: "echo hi" } };
  const provider = new FakeProvider(scriptFor(call));

  const registry = new ToolRegistry();
  registry.register(runCommandTool);
  const agent = makeAgent("free", provider, [runCommandTool]);

  const { events } = await runToEnd(agent, "run something");
  const types = events.map((e) => e.type);

  const callAt = types.indexOf("tool_call");
  const resultAt = types.indexOf("tool_result");
  const progressAt = types.indexOf("tool_progress");
  assert.ok(callAt !== -1 && resultAt !== -1, "expected tool_call and tool_result");
  assert.ok(progressAt > callAt && progressAt < resultAt, "progress must stream mid-execution");

  const progress = events.filter((e) => e.type === "tool_progress");
  assert.ok(
    progress.some((e) => (e.progress.output ?? []).includes("hi")),
    "expected the command's output line in the progress events",
  );
});
