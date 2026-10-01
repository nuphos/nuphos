import { bodyLimit } from 'hono/body-limit'

import { MAX_SKILL_UPLOAD_BYTES } from './service'

/** File limit plus multipart field names, boundaries, and disposition headers. */
export const MAX_SKILL_UPLOAD_REQUEST_BYTES = MAX_SKILL_UPLOAD_BYTES + 256 * 1024

export const skillUploadBodyLimit = bodyLimit({
  maxSize: MAX_SKILL_UPLOAD_REQUEST_BYTES,
  onError: (c) =>
    c.json(
      {
        error: {
          code: 'skill_upload_too_large',
          message: `Upload exceeds ${String(MAX_SKILL_UPLOAD_BYTES)} bytes`,
          requestId: c.get('requestId'),
        },
      },
      413,
    ),
})
