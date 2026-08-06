import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines } from "../src/cli/diff.js";

test("identical texts produce no output", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nb\nc"), []);
});

test("a changed line shows del then add, with surrounding context", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nB\nc"), [
    { type: "context", text: "a" },
    { type: "del", text: "b" },
    { type: "add", text: "B" },
    { type: "context", text: "c" },
  ]);
});

test("inserted lines are shown as additions", () => {
  assert.deepEqual(diffLines("a\nd", "a\nb\nc\nd"), [
    { type: "context", text: "a" },
    { type: "add", text: "b" },
    { type: "add", text: "c" },
    { type: "context", text: "d" },
  ]);
});

test("deleted lines are shown as deletions", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nc"), [
    { type: "context", text: "a" },
    { type: "del", text: "b" },
    { type: "context", text: "c" },
  ]);
});

test("distant changes are separated by a gap, nearby ones are merged", () => {
  const oldText = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n");
  const newText = ["one", "2", "3", "4", "5", "6", "7", "8", "9", "ten"].join("\n");
  const diff = diffLines(oldText, newText);

  assert.ok(diff.some((line) => line.type === "gap"), "expected a gap between distant hunks");
  assert.ok(diff.some((line) => line.type === "del" && line.text === "1"));
  assert.ok(diff.some((line) => line.type === "add" && line.text === "one"));
  assert.ok(diff.some((line) => line.type === "del" && line.text === "10"));
  assert.ok(diff.some((line) => line.type === "add" && line.text === "ten"));

  assert.ok(!diff.some((line) => line.text === "5"));
});

test("a one-line file rewrite is a del+add pair", () => {
  assert.deepEqual(diffLines("old", "new"), [
    { type: "del", text: "old" },
    { type: "add", text: "new" },
  ]);
});
