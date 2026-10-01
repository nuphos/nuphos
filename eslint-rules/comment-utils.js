const DIRECTIVE =
  /^\s*(?:eslint|globals?|exported|jsx|prettier-ignore|istanbul|c8|v8|@ts-|biome-ignore|deno-lint|type-coverage:|dprint-ignore|@jsx|#__PURE__|webpackChunkName|vite-ignore)/

export function isDirective(comment) {
  return DIRECTIVE.test(comment.value)
}

export function normalizeCommentText(comment) {
  let s = comment.value

  if (comment.type === 'Block') {
    // Drop the leading `*` that JSDoc puts on every continuation line.
    // `[ \t]*` rather than `\s*`: `\s` matches newlines, which lets the engine
    // backtrack across lines.
    s = s.replace(/^[ \t]*\*/gm, ' ')
  }
  s = s.replace(/`[^`]*`/g, ' ')
  s = s.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ')
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ')

  return s.trim()
}

export function wordCount(normalized) {
  return normalized ? normalized.split(' ').length : 0
}

export function classifyLines(sourceCode) {
  const total = sourceCode.lines.length
  const isComment = new Array(total + 1).fill(false)
  const isCode = new Array(total + 1).fill(false)

  for (const comment of sourceCode.getAllComments()) {
    if (isDirective(comment)) continue
    for (let l = comment.loc.start.line; l <= comment.loc.end.line; l++) isComment[l] = true
  }
  for (const token of sourceCode.ast.tokens) {
    for (let l = token.loc.start.line; l <= token.loc.end.line; l++) isCode[l] = true
  }

  return {
    total,
    /** 1-based. */
    commentOnly: (line) => isComment[line] && !isCode[line],
    blank: (line) => sourceCode.lines[line - 1].trim() === '',
  }
}
