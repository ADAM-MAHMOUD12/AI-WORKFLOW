function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isActionEnvelope(value) {
  return Array.isArray(value) ||
    (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.actions));
}

function fencedBlock(reply, language) {
  const opening = new RegExp(`(?:^|\\n)[\\t ]*\`\`\`[\\t ]*${language}\\b[^\\r\\n]*\\r?\\n`, "im");
  const match = opening.exec(reply);
  if (!match) return null;
  const start = match.index + match[0].length;
  const closing = /(?:^|\n)[\t ]*```[\t ]*(?:\r?\n|$)/gm;
  closing.lastIndex = start;
  const end = closing.exec(reply);
  return {
    value: reply.slice(start, end ? end.index + (reply[end.index] === "\n" ? 0 : 1) : reply.length).trim(),
    start: match.index,
    end: end ? end.index + end[0].length : reply.length,
    complete: Boolean(end),
  };
}

function balancedJson(reply, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < reply.length; index += 1) {
    const character = reply[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return { value: reply.slice(start, index + 1), start, end: index + 1 };
    }
  }
  return { value: reply.slice(start), start, end: reply.length };
}

function extractActionBlock(reply) {
  const taskflow = fencedBlock(reply, "taskflow-actions");
  if (taskflow) return taskflow;

  const fences = [...reply.matchAll(/(?:^|\n)[\t ]*```[\t ]*(?:json)?[^\r\n]*\r?\n/gim)];
  for (const opening of fences) {
    const start = opening.index + opening[0].length;
    const closing = /(?:^|\n)[\t ]*```[\t ]*(?:\r?\n|$)/gm;
    closing.lastIndex = start;
    const ending = closing.exec(reply);
    const value = reply.slice(start, ending ? ending.index + (reply[ending.index] === "\n" ? 0 : 1) : reply.length).trim();
    if (isActionEnvelope(parseJson(value))) {
      return {
        value,
        start: opening.index,
        end: ending ? ending.index + ending[0].length : reply.length,
        complete: Boolean(ending),
      };
    }
  }

  const objectStart = reply.search(/\{\s*"actions"\s*:/);
  if (objectStart >= 0) return balancedJson(reply, objectStart);

  const arrayStart = reply.search(/\[\s*\{\s*"type"\s*:/);
  if (arrayStart >= 0) return balancedJson(reply, arrayStart);
  return null;
}

function parseActionPayload(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("The action block is not valid JSON.", { cause: error });
  }
  const actions = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.actions)
      ? parsed.actions
      : undefined;
  if (!actions) throw new Error("Actions must be a JSON array or an object containing an actions array.");
  if (actions.length < 1 || actions.length > 20) {
    throw new Error(`The action list must contain between 1 and 20 actions (received ${actions.length}).`);
  }
  return actions;
}

function parseActionBlock(block) {
  if (block.complete === false) throw new Error("The action block is missing its closing fence.");
  return parseActionPayload(block.value);
}

function visibleChatReply(reply) {
  const block = extractActionBlock(reply);
  if (!block) return reply.trim();
  return `${reply.slice(0, block.start)}${reply.slice(block.end)}`.trim();
}

module.exports = { extractActionBlock, parseActionBlock, parseActionPayload, visibleChatReply };
