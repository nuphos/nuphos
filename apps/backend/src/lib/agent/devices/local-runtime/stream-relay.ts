import { streamChannel } from './protocol'

import type { TunnelBus } from './bus'
import type { TunnelConnection } from './holder-types'
import type { StreamMessage } from './protocol'

/**
 * Stream frames cross Redis pub/sub, which keeps nothing for a side that is not
 * listening. A frame that reached nobody is lost, so its stream ends on both
 * sides: the runtime sees its connection close and resends what still waits for
 * an answer, instead of waiting on a reply that will never come.
 */
export function streamRelay(
  bus: TunnelBus,
  streams: Map<string, unknown>,
  connection: Pick<TunnelConnection, 'send'>,
) {
  const publish = (s: string, message: StreamMessage) =>
    bus.publish(streamChannel(s), JSON.stringify(message)).catch(() => 0)

  return {
    /** To the backend side; the computer's side ends if nobody received it. */
    toStream: async (s: string, message: StreamMessage): Promise<void> => {
      if ((await publish(s, message)) > 0 || !streams.delete(s)) return
      connection.send({ t: 'close', s })
    },
    /** To the computer; a stream already ended here tells the backend side, which may not know. */
    toComputer: (s: string, d: string): void => {
      if (streams.has(s)) connection.send({ t: 'data', s, d })
      else void publish(s, { t: 'close', code: 1006, reason: 'A message on this stream was lost' })
    },
  }
}
