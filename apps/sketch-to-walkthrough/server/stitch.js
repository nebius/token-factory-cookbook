import { parse } from 'acorn';

/** Drops the trailing partial line so a continuation can restart on a clean line boundary. */
export function completeLines(text) {
  const cut = text.lastIndexOf('\n');
  return cut === -1 ? '' : text.slice(0, cut + 1);
}

export function lastNonEmptyLine(text) {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  return lines.at(-1) ?? '';
}

/**
 * Joins a resumed model response onto the text it continues. Models asked to "continue" often
 * reopen a code fence, add a sentence, or repeat a few lines; any of those breaks the module.
 */
export function joinContinuation(head, continuation) {
  let rest = continuation.replace(/^\s*\n/, '');
  // Leading prose and/or a reopened fence within the first few lines.
  const lines = rest.split('\n');
  // A tagged fence (```js) always opens; a bare one at the very start opens only if another follows.
  const fenceAt = lines.slice(0, 4).findIndex((line) => /^\s*```[\w-]+\s*$/.test(line));
  const bareReopen = /^\s*```\s*$/.test(lines[0] ?? '') && lines.slice(1).some((line) => /^\s*```\s*$/.test(line));
  if (fenceAt !== -1) rest = lines.slice(fenceAt + 1).join('\n');
  else if (bareReopen) rest = lines.slice(1).join('\n');
  // Repeated lines: the longest run at the end of head that the continuation starts with.
  const headLines = head.replace(/\n$/, '').split('\n');
  const restLines = rest.split('\n');
  const max = Math.min(60, headLines.length, restLines.length);
  for (let n = max; n > 0; n--) {
    const tail = headLines.slice(-n).map((line) => line.trim());
    const start = restLines.slice(0, n).map((line) => line.trim());
    if (tail.every((line, i) => line === start[i]) && tail.some(Boolean)) {
      rest = restLines.slice(n).join('\n');
      break;
    }
  }
  return head + rest;
}

/** A closed HTTP body is not proof of a complete model response. */
export function streamIsComplete(completed, finishReason, failure) {
  return !failure && finishReason !== 'length' && (completed || finishReason === 'stop');
}

/** Recover complete review objects even if an earlier continuation damaged an outer JSON string. */
export function recoverReviewResponses(text) {
  const recovered = [];
  for (const match of text.matchAll(/\{\s*"verdict"\s*:/g)) {
    const start = match.index;
    let depth = 1, inString = false, escaped = false;
    for (let i = start + 1; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          try {
            const review = JSON.parse(text.slice(start, i + 1));
            if (['PASS', 'REVISE'].includes(review.verdict) && typeof review.code === 'string') {
              recovered.push({ review, offset: start });
            }
          } catch { /* A partial or damaged earlier response is not a review candidate. */ }
          break;
        }
      }
    }
  }
  return recovered;
}

/** Same extraction as the client (src/lib/module.ts extractModule), syntax only. */
export function moduleParses(text) {
  const clean = text.trim();
  const fenced = clean.match(/```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : clean).trim();
  try {
    parse(source, { ecmaVersion: 2022, sourceType: 'module' });
    return true;
  } catch {
    return false;
  }
}
