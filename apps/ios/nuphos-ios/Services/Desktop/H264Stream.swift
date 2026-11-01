import CoreMedia
import Foundation

/// Turns the Annex B H.264 a computer sends in Open H.264 rectangles
/// (encoding 50) into samples a display layer shows as soon as they decode.
/// As in Sill's display view (github.com/Saffsanity/sill, Apache-2.0): every
/// sample is marked to display immediately, nothing is scheduled by
/// timestamp, and deltas wait for a keyframe after a reset.
nonisolated final class H264Stream {
    private var format: CMVideoFormatDescription?
    private var parameterSets: [[UInt8]] = []
    private var waitingForKeyframe = true

    /// Forgets the stream, as the rectangle's reset flags ask.
    func reset() {
        format = nil
        parameterSets = []
        waitingForKeyframe = true
    }

    /// The sample for one access unit, or nil while there is no keyframe yet.
    func sample(_ annexB: [UInt8]) -> CMSampleBuffer? {
        var units: [[UInt8]] = []
        var sps: [UInt8]?, pps: [UInt8]?
        var keyframe = false
        for unit in Self.units(annexB) {
            switch unit[0] & 0x1F {
            case 7: sps = unit
            case 8: pps = unit
            case 5: keyframe = true; units.append(unit)
            case 1: units.append(unit)
            default: break
            }
        }
        if let sps, let pps, [sps, pps] != parameterSets {
            format = Self.format(sps: sps, pps: pps)
            // Only a format that was made is remembered, so a bad one is tried again with the next keyframe.
            parameterSets = format == nil ? [] : [sps, pps]
        }
        guard let format, !units.isEmpty else { return nil }
        if waitingForKeyframe {
            guard keyframe else { return nil }
            waitingForKeyframe = false
        }

        // The decoder wants each unit behind a 4-byte big-endian length.
        var data: [UInt8] = []
        for unit in units {
            data += [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: unit.count >> $0) } + unit
        }
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(
            allocator: nil, memoryBlock: nil, blockLength: data.count, blockAllocator: nil, customBlockSource: nil,
            offsetToData: 0, dataLength: data.count, flags: 0, blockBufferOut: &block
        ) == noErr, let block, CMBlockBufferAssureBlockMemory(block) == noErr,
            data.withUnsafeBytes({ CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count) }) == noErr
        else { return nil }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .invalid, decodeTimeStamp: .invalid)
        var size = data.count
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReady(
            allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: 1, sampleTimingEntryCount: 1,
            sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample
        ) == noErr, let sample else { return nil }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as NSArray?,
           let first = attachments.firstObject as? NSMutableDictionary {
            first[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }
        return sample
    }

    /// The units between start codes, without them.
    static func units(_ data: [UInt8]) -> [[UInt8]] {
        var starts: [(at: Int, length: Int)] = []
        var i = 0
        while i + 3 <= data.count {
            if data[i] == 0, data[i + 1] == 0 {
                if data[i + 2] == 1 { starts.append((i, 3)); i += 3; continue }
                if i + 4 <= data.count, data[i + 2] == 0, data[i + 3] == 1 { starts.append((i, 4)); i += 4; continue }
            }
            i += 1
        }
        return starts.indices.compactMap { n in
            let from = starts[n].at + starts[n].length
            let to = n + 1 < starts.count ? starts[n + 1].at : data.count
            return to > from ? Array(data[from..<to]) : nil
        }
    }

    private static func format(sps: [UInt8], pps: [UInt8]) -> CMVideoFormatDescription? {
        var format: CMVideoFormatDescription?
        let status = sps.withUnsafeBufferPointer { s in
            pps.withUnsafeBufferPointer { p in
                let pointers = [s.baseAddress!, p.baseAddress!]
                let sizes = [sps.count, pps.count]
                return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: nil, parameterSetCount: 2, parameterSetPointers: pointers, parameterSetSizes: sizes,
                    nalUnitHeaderLength: 4, formatDescriptionOut: &format
                )
            }
        }
        return status == noErr ? format : nil
    }
}
