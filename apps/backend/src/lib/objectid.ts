import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

export function parseObjectId(input: string, label = 'id'): ObjectId {
  if (!ObjectId.isValid(input)) {
    throw new AppError(400, 'invalid_id', `Invalid ${label}: ${input}`)
  }

  return new ObjectId(input)
}
