#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

struct Options {
  var keyword: String?
  var outputPath: String?
  var listOnly = false
  var activate = false
  var delay: TimeInterval = 0
  var help = false
}

struct WindowInfo {
  let id: Int
  let owner: String
  let title: String
  let pid: pid_t
  let bounds: CGRect
}

enum CaptureWindowError: Error, CustomStringConvertible {
  case message(String)

  var description: String {
    switch self {
    case let .message(message):
      return message
    }
  }
}

func printUsage() {
  print("""
  Capture a visible macOS window by app name or window-title keyword.

  Usage:
    swift scripts/capture-window.swift <keyword> [--output <png-path>] [--activate] [--delay <seconds>]
    swift scripts/capture-window.swift --list [keyword]

  Examples:
    bun run screenshot:window -- "Netease"
    bun run screenshot:window -- "网易云" --activate
    bun run screenshot:window -- "Google Chrome" --output ~/Desktop/chrome.png
    bun run screenshot:window -- --list "音乐"

  Options:
    -o, --output <path>   Output PNG path. Defaults to ~/Desktop/window_screenshot_<keyword>_<timestamp>.png.
        --activate        Bring the matched app to the front before capture.
        --delay <seconds> Wait before capture, useful after --activate.
        --list            List visible windows, optionally filtered by keyword.
    -h, --help            Show this help.
  """)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  fputs("Error: \(message)\n", stderr)
  exit(code)
}

func parseArgs(_ args: [String]) throws -> Options {
  var options = Options()
  var positional: [String] = []
  var index = 0

  while index < args.count {
    let argument = args[index]
    switch argument {
    case "-h", "--help":
      options.help = true
    case "--list":
      options.listOnly = true
    case "--activate":
      options.activate = true
    case "-o", "--output":
      index += 1
      guard index < args.count else {
        throw CaptureWindowError.message("\(argument) requires a path.")
      }
      options.outputPath = args[index]
    case "--delay":
      index += 1
      guard index < args.count, let delay = TimeInterval(args[index]), delay >= 0 else {
        throw CaptureWindowError.message("--delay requires a non-negative number.")
      }
      options.delay = delay
    default:
      if argument.hasPrefix("-") {
        throw CaptureWindowError.message("Unexpected option: \(argument)")
      }
      positional.append(argument)
    }

    index += 1
  }

  if !positional.isEmpty {
    options.keyword = positional.joined(separator: " ")
  }

  return options
}

func visibleWindows() -> [WindowInfo] {
  guard let windowList = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
  ) as? [[String: Any]] else {
    return []
  }

  return windowList.compactMap { rawWindow in
    guard
      let id = rawWindow[kCGWindowNumber as String] as? Int,
      let owner = rawWindow[kCGWindowOwnerName as String] as? String,
      let pidValue = rawWindow[kCGWindowOwnerPID as String] as? Int,
      let layer = rawWindow[kCGWindowLayer as String] as? Int,
      let rawBounds = rawWindow[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: rawBounds as CFDictionary)
    else {
      return nil
    }

    let title = rawWindow[kCGWindowName as String] as? String ?? ""
    guard layer == 0, bounds.width >= 40, bounds.height >= 40, !owner.isEmpty else {
      return nil
    }

    return WindowInfo(
      id: id,
      owner: owner,
      title: title,
      pid: pid_t(pidValue),
      bounds: bounds
    )
  }
}

func normalized(_ value: String) -> String {
  value
    .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
    .lowercased()
}

func matches(_ window: WindowInfo, keyword: String) -> Bool {
  let haystack = normalized("\(window.owner) \(window.title)")
  return haystack.contains(normalized(keyword))
}

func matchingWindows(from windows: [WindowInfo], keyword: String?) -> [WindowInfo] {
  guard let keyword, !keyword.isEmpty else {
    return windows
  }
  return windows.filter { matches($0, keyword: keyword) }
}

func defaultFilename(for window: WindowInfo, keyword: String?) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.dateFormat = "yyyyMMdd_HHmmss"

  let rawName = keyword ?? (window.title.isEmpty ? window.owner : window.title)
  let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
  let slug = rawName.unicodeScalars.map { scalar in
    allowed.contains(scalar) ? String(scalar) : "_"
  }.joined()
  let normalizedSlug = slug.split(separator: "_").joined(separator: "_")
  let safeSlug = normalizedSlug.isEmpty ? "window" : normalizedSlug

  return "window_screenshot_\(safeSlug)_\(formatter.string(from: Date())).png"
}

func expandTilde(_ path: String) -> String {
  guard path == "~" || path.hasPrefix("~/") else {
    return path
  }
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  if path == "~" {
    return home
  }
  return home + String(path.dropFirst())
}

func resolveOutputPath(_ rawPath: String?, window: WindowInfo, keyword: String?) throws -> String {
  let fileManager = FileManager.default
  let filename = defaultFilename(for: window, keyword: keyword)

  if let rawPath, !rawPath.isEmpty {
    var path = expandTilde(rawPath)
    var isDirectory: ObjCBool = false
    if fileManager.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue {
      path = URL(fileURLWithPath: path).appendingPathComponent(filename).path
    } else if path.hasSuffix("/") {
      path = URL(fileURLWithPath: path).appendingPathComponent(filename).path
    } else if URL(fileURLWithPath: path).pathExtension.isEmpty {
      path += ".png"
    }
    try fileManager.createDirectory(
      at: URL(fileURLWithPath: path).deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    return path
  }

  let desktop = fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Desktop").path
  var isDirectory: ObjCBool = false
  let outputDirectory = fileManager.fileExists(atPath: desktop, isDirectory: &isDirectory) && isDirectory.boolValue
    ? desktop
    : fileManager.currentDirectoryPath

  return URL(fileURLWithPath: outputDirectory).appendingPathComponent(filename).path
}

func printWindows(_ windows: [WindowInfo]) {
  if windows.isEmpty {
    print("No visible windows found.")
    return
  }

  print("ID\tAPP\tTITLE\tSIZE\tPOSITION")
  for window in windows {
    let width = Int(window.bounds.width)
    let height = Int(window.bounds.height)
    let x = Int(window.bounds.origin.x)
    let y = Int(window.bounds.origin.y)
    print("\(window.id)\t\(window.owner)\t\(window.title)\t\(width)x\(height)\t+\(x)+\(y)")
  }
}

func activateApp(for window: WindowInfo) {
  guard let app = NSRunningApplication(processIdentifier: window.pid) else {
    return
  }
  app.activate(options: [])
}

func capture(window: WindowInfo, to outputPath: String) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l", String(window.id), outputPath]

  try process.run()
  process.waitUntilExit()

  guard process.terminationStatus == 0 else {
    throw CaptureWindowError.message("screencapture failed with exit code \(process.terminationStatus).")
  }
}

do {
  let options = try parseArgs(Array(CommandLine.arguments.dropFirst()))

  if options.help {
    printUsage()
    exit(0)
  }

  let windows = visibleWindows()
  let matches = matchingWindows(from: windows, keyword: options.keyword)

  if options.listOnly {
    printWindows(matches)
    exit(matches.isEmpty ? 1 : 0)
  }

  guard let keyword = options.keyword, !keyword.isEmpty else {
    printUsage()
    exit(2)
  }

  guard let window = matches.first else {
    fail("No visible window matched \"\(keyword)\". Run with --list to inspect available windows.", code: 1)
  }

  if options.activate {
    activateApp(for: window)
  }

  if options.delay > 0 {
    Thread.sleep(forTimeInterval: options.delay)
  }

  let outputPath = try resolveOutputPath(options.outputPath, window: window, keyword: keyword)
  try capture(window: window, to: outputPath)

  if matches.count > 1 {
    print("Matched \(matches.count) windows; captured the frontmost match. Use --list to inspect matches.")
  }
  print("Captured: \(window.owner)\(window.title.isEmpty ? "" : " - \(window.title)")")
  print("Saved: \(outputPath)")
} catch let error as CaptureWindowError {
  fail(error.description, code: 2)
} catch {
  fail(String(describing: error), code: 1)
}
