import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describePermissionMode,
  needsApproval,
  parsePermissionMode,
  PERMISSION_MODES,
} from "../src/core/agent/permissions.js";

test("needsApproval: safe asks for writes and exec, never for reads", () => {
  assert.equal(needsApproval("safe", "read"), false);
  assert.equal(needsApproval("safe", "write"), true);
  assert.equal(needsApproval("safe", "exec"), true);
});

test("needsApproval: work asks for exec only", () => {
  assert.equal(needsApproval("work", "read"), false);
  assert.equal(needsApproval("work", "write"), false);
  assert.equal(needsApproval("work", "exec"), true);
});

test("needsApproval: free never asks", () => {
  assert.equal(needsApproval("free", "read"), false);
  assert.equal(needsApproval("free", "write"), false);
  assert.equal(needsApproval("free", "exec"), false);
});

test("parsePermissionMode accepts case-insensitive names with whitespace", () => {
  assert.equal(parsePermissionMode("safe"), "safe");
  assert.equal(parsePermissionMode(" WORK "), "work");
  assert.equal(parsePermissionMode("Free"), "free");
});

test("parsePermissionMode rejects unknown values", () => {
  assert.equal(parsePermissionMode("yolo"), undefined);
  assert.equal(parsePermissionMode(""), undefined);
});

test("every mode has a description", () => {
  for (const mode of PERMISSION_MODES) {
    assert.ok(describePermissionMode(mode).startsWith(mode));
  }
});
