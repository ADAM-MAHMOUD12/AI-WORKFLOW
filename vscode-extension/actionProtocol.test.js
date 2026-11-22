const assert = require("node:assert/strict");
const test = require("node:test");
const { extractActionBlock, parseActionBlock, parseActionPayload, visibleChatReply } = require("./actionProtocol");

const writeFileAction = {
  type: "code.write_file",
  path: "python_todo_demo/todo.py",
  content: "def main():\n    print(\"todo\")\n",
};

test("parses a fenced Taskflow action envelope with escaped source text", () => {
  const reply = [
    "I prepared the requested file.",
    "```taskflow-actions",
    JSON.stringify({ actions: [writeFileAction] }),
    "```",
  ].join("\n");
  const block = extractActionBlock(reply);

  assert.ok(block);
  assert.equal(block.complete, true);
  assert.deepEqual(parseActionPayload(block.value), [writeFileAction]);
  assert.equal(visibleChatReply(reply), "I prepared the requested file.");
});

test("extracts a bare actions object after explanatory text", () => {
  const reply = `Here is the change:\n${JSON.stringify({ actions: [writeFileAction] })}\nDone.`;
  const block = extractActionBlock(reply);

  assert.ok(block);
  assert.deepEqual(parseActionPayload(block.value), [writeFileAction]);
  assert.equal(visibleChatReply(reply), "Here is the change:\n\nDone.");
});

test("accepts a bare action array and a standard JSON fence", () => {
  const bareArray = extractActionBlock(JSON.stringify([writeFileAction]));
  const jsonFence = extractActionBlock([
    "```json",
    JSON.stringify({ actions: [writeFileAction] }),
    "```",
  ].join("\n"));

  assert.ok(bareArray);
  assert.ok(jsonFence);
  assert.deepEqual(parseActionPayload(bareArray.value), [writeFileAction]);
  assert.deepEqual(parseActionPayload(jsonFence.value), [writeFileAction]);
});

test("refuses to parse an action fence that was never closed", () => {
  const block = extractActionBlock([
    "```taskflow-actions",
    JSON.stringify({ actions: [writeFileAction] }),
  ].join("\n"));

  assert.ok(block);
  assert.equal(block.complete, false);
  assert.throws(() => parseActionBlock(block), /missing its closing fence/);
});

test("extracts and hides standard TF CODE action JSON while preserving the explanation", () => {
  const reply = [
    "I will create the requested file.",
    "```taskflow-actions",
    JSON.stringify({ actions: [writeFileAction] }),
    "```",
  ].join("\n");
  const block = extractActionBlock(reply);

  assert.ok(block);
  assert.equal(block.complete, true);
  assert.deepEqual(parseActionBlock(block), [writeFileAction]);
  assert.equal(visibleChatReply(reply), "I will create the requested file.");
});

test("does not mistake ordinary code examples for action blocks", () => {
  assert.equal(extractActionBlock("```python\nprint('hello')\n```"), null);
  assert.throws(() => parseActionPayload("{not json}"), /not valid JSON/);
  assert.throws(() => parseActionPayload('{"result":"not an action"}'), /actions array/);
});

test("preserves Bash terminal commands in action envelopes", () => {
  const bashAction = { type: "code.run_command", shell: "bash", command: "python -m unittest python_todo_demo/test_todo_app.py" };
  const block = extractActionBlock(JSON.stringify({ actions: [bashAction] }));

  assert.ok(block);
  assert.deepEqual(parseActionPayload(block.value), [bashAction]);
});

test("rejects empty or oversized action batches before execution", () => {
  assert.throws(() => parseActionPayload('{"actions":[]}'), /between 1 and 20/);
  assert.throws(() => parseActionPayload(JSON.stringify({ actions: Array(21).fill(writeFileAction) })), /between 1 and 20/);
});
