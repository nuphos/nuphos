// Stream ordinary text immediately; retain only an ambiguous Markdown token tail.
export async function nuphosStreamReplyImages(chunk, state, upload, final = false) {
  const scan = (state.scan ??= {
    tail: '',
    column: 0,
    inline: 0,
    fence: '',
    fenceSize: 0,
    slashes: 0,
    images: 0,
  })
  const input = scan.tail + chunk
  scan.tail = ''
  let output = '',
    i = 0
  const emit = (text) => {
    output += text
    for (const char of text) {
      scan.column =
        char === '\n'
          ? 0
          : char === ' ' && scan.column >= 0 && scan.column < 3
            ? scan.column + 1
            : -1
      scan.slashes = char === '\\' ? scan.slashes + 1 : 0
    }
  }
  while (i < input.length) {
    const char = input[i]
    if (scan.fence) {
      if (char === scan.fence && scan.column >= 0) {
        const end = input.indexOf('\n', i)
        if (end < 0 && !final && input.length - i < 8192) break
        const line = input.slice(i, end < 0 ? input.length : end)
        const run = line.match(/^(`+|~+)/)?.[0] ?? ''
        if (run.length >= scan.fenceSize && /^[ \t]*$/.test(line.slice(run.length))) scan.fence = ''
        emit(line)
        i += line.length
      } else {
        emit(char)
        i++
      }
      continue
    }
    if (
      (char === '`' || (char === '~' && scan.column >= 0 && !scan.inline)) &&
      !(scan.slashes % 2)
    ) {
      let end = i + 1
      while (input[end] === char) end++
      if (end === input.length && !final && end - i < 8192) break
      const size = end - i
      if (scan.column >= 0 && !scan.inline && size >= 3) {
        scan.fence = char
        scan.fenceSize = size
      } else if (char === '`') scan.inline = scan.inline === size ? 0 : scan.inline || size
      emit(input.slice(i, end))
      i = end
      continue
    }
    if (char === '!' && !scan.inline && !(scan.slashes % 2)) {
      if (i + 1 === input.length && !final) break
      if (input[i + 1] === '[') {
        const remaining = input.slice(i)
        const image = /^!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)/.exec(
          remaining,
        )?.[0]
        if (image) {
          const source = /^!\[[^\]\n]*\]\(<?([^>\s)]+)/.exec(image)?.[1] ?? ''
          if (!/^(?:https?:|data:)/i.test(source)) {
            scan.images++
            state.uploadSignal ??= AbortSignal.timeout(20_000)
            output +=
              scan.images > 8
                ? '**Image unavailable:** Too many images in this reply.'
                : await upload(image, state)
          } else output += image
          // An image is ordinary inline content for fence/escape tracking.
          scan.column = -1
          scan.slashes = 0
          i += image.length
          continue
        }
        // Once the closing alt bracket rules out an image, release it immediately.
        const altEnd = remaining.indexOf(']')
        const impossible =
          /\n/.test(remaining) ||
          (altEnd >= 0 && remaining[altEnd + 1] && remaining[altEnd + 1] !== '(')
        if (!impossible && !final && remaining.length < 8192) break
      }
    }
    emit(char)
    i++
  }
  scan.tail = input.slice(i)
  return output
}
