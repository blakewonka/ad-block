// make-ios-icon.swift: derive the iOS app icon from the macOS one.
//
//   swift platforms/safari/tools/make-ios-icon.swift \
//       assets/icons/app/mac-icon-512@2x.png assets/icons/app/universal-icon-1024@1x.png
//
// The macOS icon (1024 x 1024) is a rounded tile with transparent margins and a
// drop shadow. iOS wants a full-bleed, opaque square (the system applies the
// mask), so this scales the tile to fill the canvas, repaints every pixel
// outside the artwork's bounding box with the tile's own vertical background
// gradient (sampled down the centre column), and writes an RGB PNG with no
// alpha channel. Run it again after you change the macOS icon, or replace the
// output with your own 1024 x 1024 opaque PNG.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func die(_ msg: String) -> Never {
    FileHandle.standardError.write("make-ios-icon: \(msg)\n".data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count == 3 else { die("usage: make-ios-icon.swift <mac-icon-1024.png> <out-1024.png>") }
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { die("cannot read \(args[1])") }

let w = image.width, h = image.height
guard w == h, w >= 512 else { die("input must be square and at least 512 px, got \(w)x\(h)") }
let space = CGColorSpace(name: CGColorSpace.sRGB)!
var px = [UInt8](repeating: 0, count: w * h * 4)
guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { die("no context") }
ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
func at(_ x: Int, _ y: Int) -> (UInt8, UInt8, UInt8, UInt8) {
    let i = (y * w + x) * 4
    return (px[i], px[i + 1], px[i + 2], px[i + 3])
}
func opaque(_ x: Int, _ y: Int) -> Bool { at(x, y).3 == 255 }

// Tile bounds: first/last fully opaque pixel on the centre row and column.
let c = w / 2
guard let left = (0..<w).first(where: { opaque($0, c) }), let right = (0..<w).last(where: { opaque($0, c) }),
      let top = (0..<h).first(where: { opaque(c, $0) }), let bottom = (0..<h).last(where: { opaque(c, $0) })
else { die("no opaque tile found") }
// Background colour of a row = the tile's colour at the left edge of the centre band.
let edge = 24
func background(_ y: Int) -> (UInt8, UInt8, UInt8, UInt8) {
    at(left + edge * 4, min(max(y, top + edge), bottom - edge))
}
// Artwork bounding box: pixels that differ clearly from their row's background.
var minX = w, minY = h, maxX = 0, maxY = 0
for y in (top + edge)...(bottom - edge) {
    let b = background(y)
    // only the opaque run of this row, minus the tile's edge highlight
    guard let l = (left...right).first(where: { opaque($0, y) }), let r = (left...right).last(where: { opaque($0, y) }),
          r - l > 2 * edge else { continue }
    for x in (l + edge)...(r - edge) {
        let p = at(x, y)
        let d = abs(Int(p.0) - Int(b.0)) + abs(Int(p.1) - Int(b.1)) + abs(Int(p.2) - Int(b.2))
        if d > 24 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
    }
}
guard minX < maxX, minY < maxY else { die("no artwork found inside the tile") }
let pad = 12
minX -= pad; minY -= pad; maxX += pad; maxY += pad

// Bilinear sample (the artwork is scaled up by about 1.24).
func bilinear(_ fx: Double, _ fy: Double) -> (UInt8, UInt8, UInt8, UInt8) {
    let x0 = Int(fx.rounded(.down)), y0 = Int(fy.rounded(.down))
    let tx = fx - Double(x0), ty = fy - Double(y0)
    let a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
    func mix(_ p: UInt8, _ q: UInt8, _ r: UInt8, _ s: UInt8) -> UInt8 {
        let top = Double(p) * (1 - tx) + Double(q) * tx, bot = Double(r) * (1 - tx) + Double(s) * tx
        return UInt8(max(0, min(255, (top * (1 - ty) + bot * ty).rounded())))
    }
    return (mix(a.0, b.0, c.0, d.0), mix(a.1, b.1, c.1, d.1), mix(a.2, b.2, c.2, d.2), 255)
}

let size = 1024
var out = [UInt8](repeating: 255, count: size * size * 4)
let sx = Double(right - left + 1) / Double(size), sy = Double(bottom - top + 1) / Double(size)
for Y in 0..<size {
    for X in 0..<size {
        let fx = Double(left) + (Double(X) + 0.5) * sx - 0.5, fy = Double(top) + (Double(Y) + 0.5) * sy - 0.5
        let x = min(right, max(left, Int(fx.rounded()))), y = min(bottom, max(top, Int(fy.rounded())))
        let inArt = x >= minX && x <= maxX && y >= minY && y <= maxY
        let p = inArt ? bilinear(fx, fy) : background(y)
        let o = (Y * size + X) * 4
        out[o] = p.0; out[o + 1] = p.1; out[o + 2] = p.2; out[o + 3] = 255
    }
}
guard let octx = CGContext(data: &out, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                           space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
      let outImage = octx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { die("cannot create \(args[2])") }
CGImageDestinationAddImage(dest, outImage, nil)
guard CGImageDestinationFinalize(dest) else { die("cannot write \(args[2])") }
print("make-ios-icon: tile \(left)...\(right) x \(top)...\(bottom), artwork \(minX)...\(maxX) x \(minY)...\(maxY) -> \(args[2]) (\(size) px, opaque)")
