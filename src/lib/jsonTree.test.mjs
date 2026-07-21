import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jsonFields, jsonContainerPaths, filterJsonFields, findMarks } from "./jsonTree.ts";

describe("jsonTree helpers", () => {
  const sample = {
    id: 1,
    user: { name: "Alice", tags: ["admin", "beta"] },
    active: true,
  };

  it("flattens a JSON value into fields", () => {
    const fields = jsonFields(sample);
    assert.ok(fields.length > 1);
    assert.ok(fields.some((f) => f.path === "$.user.name"));
    assert.ok(fields.some((f) => f.path === "$.user.tags[0]"));
  });

  it("lists container paths", () => {
    const paths = jsonContainerPaths(sample);
    assert.deepEqual(paths, ["$", "$.user", "$.user.tags"]);
  });

  it("filters fields by query", () => {
    const fields = jsonFields(sample);
    const filtered = filterJsonFields(fields, "alice");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].path, "$.user.name");
  });

  it("finds case-insensitive marks", () => {
    const marks = findMarks("Hello world", "l");
    assert.deepEqual(marks, [[2, 3], [3, 4], [9, 10]]);
  });

  it("finds case-sensitive marks when asked", () => {
    const marks = findMarks("Hello world", "H", true);
    assert.deepEqual(marks, [[0, 1]]);
    assert.deepEqual(findMarks("Hello world", "h", true), []);
  });
});
