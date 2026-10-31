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
        #if !NUPHOS_SHARE_EXTENSION
        UIApplication.shared.isIdleTimerDisabled = true
        #endif
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
    func finish(token: String, teamId: String) async throws -> String {
        stopRecording()
        phase = .transcribing
        defer { try? FileManager.default.removeItem(at: file) }
        return try await Whisper.transcribe(file, token: token, teamId: teamId)
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
        #if !NUPHOS_SHARE_EXTENSION
        UIApplication.shared.isIdleTimerDisabled = false
        #endif
        #endif
    }
}

/// Transcription by OpenAI Whisper through Nuphos, which holds the key and
/// keeps voice input to teams with a subscription.
enum Whisper {
    /// The transcription prompt, editable in Account. Whisper copies its
    /// spelling and style, so it lists names Whisper would otherwise guess at.
    /// Whisper reads only its last 224 tokens.
    static let promptKey = "whisper-prompt"
    static let defaultPrompt = "Nuphos, Zeabur, Claude Code, Codex, Kubernetes, kubectl, Helm, EKS, GKE, AWS, GCP, Cloudflare, Grafana, Linear, GitHub, PR, CI."

    struct Failure: LocalizedError {
        let errorDescription: String?
    }

    static func transcribe(_ file: URL, token: String, teamId: String) async throws -> String {
        let boundary = UUID().uuidString
        var request = URLRequest(url: NuphosAPI.baseURL.appending(path: "teams/\(teamId)/voice-transcriptions"))
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue("nuphos-ios/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")", forHTTPHeaderField: "x-atlas-client")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")

        var body = Data()
        let prompt = (UserDefaults.standard.string(forKey: promptKey) ?? defaultPrompt).trimmingCharacters(in: .whitespacesAndNewlines)
        if !prompt.isEmpty {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n\(prompt)\r\n".utf8))
        }
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dictation.m4a\"\r\nContent-Type: audio/m4a\r\n\r\n".utf8))
        body.append(try Data(contentsOf: file))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        let json = try? JSONDecoder().decode(JSONValue.self, from: data)
        switch (response as? HTTPURLResponse)?.statusCode {
        case 200: break
        case 401: throw NuphosAPI.Failure.unauthorized
        default:
            throw Failure(errorDescription: json?["error"]?["message"]?.stringValue ?? "Nuphos couldn't be reached. Try again.")
        }
        guard var text = json?["text"]?.stringValue else {
            throw Failure(errorDescription: "The recording couldn't be transcribed.")
        }
        // Whisper writes Mandarin in Simplified Chinese by default; convert it to Traditional.
        if json?["language"]?.stringValue == "chinese" {
            text = text.applyingTransform(StringTransform("Hans-Hant"), reverse: false) ?? text
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
