import AVFoundation
import Foundation
import Observation

/// One voice-input take in the composer: record from the microphone while
/// sampling its level for the waveform, then hand the audio to Whisper.
@Observable
final class VoiceDictation {
    enum Phase { case starting, recording, transcribing }

    enum Failure: LocalizedError {
        case microphoneDenied

        var errorDescription: String? {
            "Allow microphone access for Nuphos in Settings to use voice input."
        }
    }

    private(set) var phase = Phase.starting
    /// Microphone level per sample, 0...1, oldest first.
    private(set) var levels: [CGFloat] = []
    private(set) var startedAt = Date()

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var meter: Task<Void, Never>?
    @ObservationIgnored private let file = FileManager.default.temporaryDirectory
        .appendingPathComponent("dictation-\(UUID().uuidString).m4a")

    func start() async throws {
        guard await AVAudioApplication.requestRecordPermission() else { throw Failure.microphoneDenied }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        #endif
        let recorder = try AVAudioRecorder(url: file, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ])
        recorder.isMeteringEnabled = true
        recorder.record()
        self.recorder = recorder
        phase = .recording
        startedAt = Date()
        meter = Task { [weak self] in
            while !Task.isCancelled, let self, let recorder = self.recorder {
                recorder.updateMeters()
                // -50 dB and below reads as silence.
                let level = max(0, min(1, (CGFloat(recorder.averagePower(forChannel: 0)) + 50) / 50))
                self.levels.append(level)
                if self.levels.count > 200 { self.levels.removeFirst(self.levels.count - 200) }
                try? await Task.sleep(for: .milliseconds(60))
            }
        }
    }

    /// Stops recording and returns what was said.
    func finish(apiKey: String) async throws -> String {
        stopRecording()
        phase = .transcribing
        defer { try? FileManager.default.removeItem(at: file) }
        return try await Whisper.transcribe(file, apiKey: apiKey)
    }

    func cancel() {
        stopRecording()
        try? FileManager.default.removeItem(at: file)
    }

    private func stopRecording() {
        meter?.cancel()
        recorder?.stop()
        recorder = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}

/// OpenAI's transcription endpoint, called with the user's own key (BYOK).
/// The key lives only in this device's Keychain.
enum Whisper {
    static let keychainKey = "openai-api-key"

    struct Failure: LocalizedError {
        let errorDescription: String?
    }

    static func transcribe(_ file: URL, apiKey: String) async throws -> String {
        let boundary = UUID().uuidString
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/audio/transcriptions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n".utf8))
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dictation.m4a\"\r\nContent-Type: audio/m4a\r\n\r\n".utf8))
        body.append(try Data(contentsOf: file))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        struct Reply: Decodable {
            struct APIError: Decodable { let message: String }
            let text: String?
            let error: APIError?
        }
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let text = reply?.text else {
            throw Failure(errorDescription: reply?.error?.message ?? "OpenAI couldn't transcribe the recording.")
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
