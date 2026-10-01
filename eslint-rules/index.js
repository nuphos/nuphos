import noDuplicateComment from './no-duplicate-comment.js'
import noHistoryReferenceComment from './no-history-reference-comment.js'
import noLargeCommentBlock from './no-large-comment-block.js'
import noOrphanedDocComment from './no-orphaned-doc-comment.js'
import noUnawaitedAsyncAssertion from './no-unawaited-async-assertion.js'

export default {
  meta: { name: 'nuphos', version: '1.0.0' },
  rules: {
    'no-large-comment-block': noLargeCommentBlock,
    'no-duplicate-comment': noDuplicateComment,
    'no-history-reference-comment': noHistoryReferenceComment,
    'no-orphaned-doc-comment': noOrphanedDocComment,
    'no-unawaited-async-assertion': noUnawaitedAsyncAssertion,
  },
}
