import Foundation
import WhisperKit

// MARK: - JSON Protocol Types

struct Request: Decodable {
    let type: String
    let model_path: String?
    let audio_path: String?
    let language: String?
}

struct Response: Encodable {
    let type: String
    var success: Bool?
    var text: String?
    var error: String?
    var model_loaded: Bool?
}

// MARK: - Sidecar Engine

actor TranscriptionEngine {
    private var whisperKit: WhisperKit?

    func loadModel(path: String) async throws {
        log("Loading model from: \(path)")
        let config = WhisperKitConfig(
            modelFolder: path,
            verbose: false,
            logLevel: .none
        )
        whisperKit = try await WhisperKit(config)
        log("Model loaded successfully")
    }

    func transcribe(audioPath: String, language: String?) async throws -> String {
        guard let kit = whisperKit else {
            throw NSError(domain: "WhisperKitSidecar", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "No model loaded"])
        }

        log("Transcribing: \(audioPath), language: \(language ?? "auto")")

        // Read raw f32 PCM audio from file
        let audioData = try Data(contentsOf: URL(fileURLWithPath: audioPath))
        let floatCount = audioData.count / MemoryLayout<Float>.size
        var audioSamples = [Float](repeating: 0, count: floatCount)
        audioData.withUnsafeBytes { rawBuffer in
            let floatBuffer = rawBuffer.bindMemory(to: Float.self)
            for i in 0..<floatCount {
                audioSamples[i] = floatBuffer[i]
            }
        }

        var options = DecodingOptions()
        if let lang = language, lang != "auto" {
            options.language = lang
        }
        options.skipSpecialTokens = true
        options.withoutTimestamps = true

        let results = try await kit.transcribe(audioArray: audioSamples, decodeOptions: options)

        let text = results.map(\.text).joined(separator: " ").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        log("Transcription result: \(text)")
        return text
    }

    func unloadModel() {
        whisperKit = nil
        log("Model unloaded")
    }

    var isModelLoaded: Bool {
        whisperKit != nil
    }
}

// MARK: - Logging (stderr only, stdout reserved for protocol)

func log(_ message: String) {
    FileHandle.standardError.write(Data("[whisperkit-sidecar] \(message)\n".utf8))
}

// MARK: - Main Loop

let engine = TranscriptionEngine()
let decoder = JSONDecoder()
let encoder = JSONEncoder()
encoder.outputFormatting = [] // compact, no pretty printing

log("WhisperKit sidecar started, waiting for commands...")

while let line = readLine(strippingNewline: true) {
    guard !line.isEmpty else { continue }

    guard let requestData = line.data(using: .utf8),
          let request = try? decoder.decode(Request.self, from: requestData) else {
        let errorResponse = Response(type: "error", success: false, error: "Invalid JSON request")
        if let data = try? encoder.encode(errorResponse), let json = String(data: data, encoding: .utf8) {
            print(json)
            fflush(stdout)
        }
        continue
    }

    var response: Response

    switch request.type {
    case "load":
        guard let modelPath = request.model_path else {
            response = Response(type: "loaded", success: false, error: "Missing model_path")
            break
        }
        do {
            try await engine.loadModel(path: modelPath)
            response = Response(type: "loaded", success: true)
        } catch {
            response = Response(type: "loaded", success: false, error: error.localizedDescription)
        }

    case "transcribe":
        guard let audioPath = request.audio_path else {
            response = Response(type: "transcription", success: false, error: "Missing audio_path")
            break
        }
        do {
            let text = try await engine.transcribe(audioPath: audioPath, language: request.language)
            response = Response(type: "transcription", success: true, text: text)
        } catch {
            response = Response(type: "transcription", success: false, error: error.localizedDescription)
        }

    case "unload":
        await engine.unloadModel()
        response = Response(type: "unloaded", success: true)

    case "health":
        let loaded = await engine.isModelLoaded
        response = Response(type: "health", model_loaded: loaded)

    case "shutdown":
        response = Response(type: "shutdown_ack", success: true)
        if let data = try? encoder.encode(response), let json = String(data: data, encoding: .utf8) {
            print(json)
            fflush(stdout)
        }
        log("Shutdown requested, exiting")
        exit(0)

    default:
        response = Response(type: "error", success: false, error: "Unknown command: \(request.type)")
    }

    if let data = try? encoder.encode(response), let json = String(data: data, encoding: .utf8) {
        print(json)
        fflush(stdout)
    }
}

log("stdin closed, exiting")
