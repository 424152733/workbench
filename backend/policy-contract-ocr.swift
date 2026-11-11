import AppKit
import Foundation
import PDFKit
import Vision

guard CommandLine.arguments.count == 3,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
  fputs("Cannot open PDF for local OCR\n", stderr)
  exit(1)
}

let pageNumbers = CommandLine.arguments[2].split(separator: ",").compactMap { Int($0) }
var output: [[String: Any]] = []

for pageNumber in pageNumbers {
  guard pageNumber > 0, pageNumber <= document.pageCount,
        let page = document.page(at: pageNumber - 1) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  guard bounds.width > 0, bounds.height > 0 else { continue }
  let width: CGFloat = 1600
  let image = page.thumbnail(
    of: NSSize(width: width, height: width * bounds.height / bounds.width),
    for: .mediaBox
  )
  guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  request.usesLanguageCorrection = true
  do {
    try VNImageRequestHandler(cgImage: cgImage).perform([request])
    let observations = (request.results ?? []).sorted {
      let delta = $0.boundingBox.midY - $1.boundingBox.midY
      return abs(delta) > 0.012 ? delta > 0 : $0.boundingBox.minX < $1.boundingBox.minX
    }
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    output.append(["num": pageNumber, "text": lines.joined(separator: "\n")])
  } catch {
    output.append(["num": pageNumber, "text": ""])
  }
}

let json = try JSONSerialization.data(withJSONObject: output)
FileHandle.standardOutput.write(json)
