import Compression
import Foundation

/// Decodes the one zlib stream a ZRLE connection carries, fed one rectangle
/// at a time: the stream state, window included, carries over between pieces.
/// Compression's ZLIB is raw DEFLATE, so the two header bytes are skipped
/// here; the stream never ends, so there is no checksum to read.
nonisolated final class ZlibStream {
    struct Corrupt: Error {}

    private let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    private var header = 2
    private let started: Bool
    private var broken = false

    init() {
        started = compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK
        broken = !started
    }

    deinit {
        if started { compression_stream_destroy(stream) }
        stream.deallocate()
    }

    /// The bytes the next piece of the stream decodes to, refusing more than
    /// `limit`: a small piece must not unpack into unbounded memory.
    func inflate(_ piece: [UInt8], limit: Int = .max) throws -> [UInt8] {
        guard !broken else { throw Corrupt() }
        let skipped = min(header, piece.count)
        header -= skipped
        let input = piece.dropFirst(skipped)
        guard !input.isEmpty else { return [] }
        var output: [UInt8] = []
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        try input.withUnsafeBufferPointer { source in
            stream.pointee.src_ptr = source.baseAddress!
            stream.pointee.src_size = source.count
            while true {
                let status = buffer.withUnsafeMutableBufferPointer { destination in
                    stream.pointee.dst_ptr = destination.baseAddress!
                    stream.pointee.dst_size = destination.count
                    return compression_stream_process(stream, 0)
                }
                let produced = buffer.count - stream.pointee.dst_size
                output += buffer[0..<produced]
                guard output.count <= limit else { broken = true; throw Corrupt() }
                guard status == COMPRESSION_STATUS_OK else { broken = true; throw Corrupt() }
                if stream.pointee.src_size == 0, produced < buffer.count { return }
            }
        }
        return output
    }
}
