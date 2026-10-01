const ASYNC_MODIFIERS = new Set(['rejects', 'resolves'])

const isExpectCall = (node) =>
  node.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && node.callee.name === 'expect') ||
    (node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.object.type === 'Identifier' &&
      node.callee.object.name === 'expect'))

const namedProperty = (node) =>
  node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : null

/** `rejects` / `resolves` if `node` is a matcher call on one, else null. */
function asyncModifier(node) {
  let current = node.callee

  while (current.type === 'MemberExpression') {
    const object = current.object
    const name = namedProperty(object)

    if (name !== null && ASYNC_MODIFIERS.has(name) && isExpectCall(object.object)) return name
    current = object
  }

  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `await` (or `return`) on `expect(...).rejects` / `.resolves` assertions, which settle asynchronously.',
    },
    // A suggestion rather than a fix: the enclosing callback is often
    // synchronous, so inserting `await` can require making it `async` too.
    hasSuggestions: true,
    schema: [],
    messages: {
      unawaited:
        '`expect(...).{{modifier}}` settles asynchronously. Prefix it with `await` (or `return`), otherwise the assertion races the rest of the test.',
      addAwait: 'Add `await`.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.parent.type !== 'ExpressionStatement') return
        const modifier = asyncModifier(node)

        if (modifier === null) return

        context.report({
          node,
          messageId: 'unawaited',
          data: { modifier },
          suggest: [
            { messageId: 'addAwait', fix: (fixer) => fixer.insertTextBefore(node, 'await ') },
          ],
        })
      },
    }
  },
}
