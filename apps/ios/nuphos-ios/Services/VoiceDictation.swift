import AVFoundation
import Foundation
import Observation
#if os(iOS)
import UIKit
#endif

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
        // The recording ends when the screen locks, so it stays on meanwhile.
        UIApplication.shared.isIdleTimerDisabled = true
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
        UIApplication.shared.isIdleTimerDisabled = false
        #endif
    }
}

/// OpenAI's transcription endpoint, called with the user's own key (BYOK).
/// The key lives only in this device's Keychain.
enum Whisper {
    static let keychainKey = "openai-api-key"

    /// The transcription prompt, editable in Account. Whisper copies its
    /// spelling and style, so it lists names Whisper would otherwise guess at.
    /// Whisper reads only its last 224 tokens.
    static let promptKey = "whisper-prompt"
    static let defaultPrompt = "Nuphos, Zeabur, Claude Code, Codex, Kubernetes, kubectl, Helm, EKS, GKE, AWS, GCP, Cloudflare, Grafana, Linear, GitHub, PR, CI."

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
        // verbose_json reports the language for the Traditional Chinese fallback below.
        var fields = [("model", "whisper-1"), ("response_format", "verbose_json")]
        let prompt = (UserDefaults.standard.string(forKey: promptKey) ?? defaultPrompt).trimmingCharacters(in: .whitespacesAndNewlines)
        if !prompt.isEmpty { fields.append(("prompt", prompt)) }
        for (name, value) in fields {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dictation.m4a\"\r\nContent-Type: audio/m4a\r\n\r\n".utf8))
        body.append(try Data(contentsOf: file))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        let reply = try reply(data, response)
        guard var text = reply.text else {
            throw Failure(errorDescription: "OpenAI couldn't transcribe the recording.")
        }
        // Whisper writes Mandarin in Simplified Chinese by default; convert it to Traditional.
        if reply.language == "chinese" {
            text = text.applyingTransform(StringTransform("Hans-Hant"), reverse: false) ?? text
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Checks a key before it is saved, with a free call it must be allowed to make.
    static func verify(_ apiKey: String) async throws {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        _ = try reply(data, response)
    }

    private struct Reply: Decodable {
        struct APIError: Decodable { let message: String }
        let text: String?
        var language: String? = nil
        let error: APIError?
    }

    private static func reply(_ data: Data, _ response: URLResponse) throws -> Reply {
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        switch (response as? HTTPURLResponse)?.statusCode {
        case 200: return reply ?? Reply(text: nil, error: nil)
        case 401:
            // A key OpenAI no longer accepts is forgotten, so the next tap asks again.
            Keychain.delete(keychainKey)
            throw Failure(errorDescription: "OpenAI rejected this API key. Tap the microphone to enter a new one.")
        default:
            throw Failure(errorDescription: reply?.error?.message ?? "OpenAI couldn't be reached. Try again.")
        }
    }
}
