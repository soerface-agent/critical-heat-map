import type { Position } from 'geojson'

// Planar distance, good enough to split a city-sized track by length
function segmentLength([x1, y1]: Position, [x2, y2]: Position): number {
  return Math.hypot((x2 - x1) * Math.cos((y1 * Math.PI) / 180), y2 - y1)
}

/** The first `fraction` (0–1) of a multi-line, measured along its length */
export function partialLines(lines: Position[][], fraction: number): Position[][] {
  const total = lines.reduce(
    (sum, line) => sum + line.slice(1).reduce((s, point, i) => s + segmentLength(line[i], point), 0),
    0,
  )
  let remaining = total * Math.min(1, Math.max(0, fraction))
  const result: Position[][] = []

  for (const line of lines) {
    const part = [line[0]]
    for (let i = 1; i < line.length; i++) {
      const length = segmentLength(line[i - 1], line[i])
      if (remaining < length) {
        const t = remaining / length
        const [x1, y1] = line[i - 1]
        const [x2, y2] = line[i]
        part.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t])
        result.push(part)
        return result
      }
      part.push(line[i])
      remaining -= length
    }
    result.push(part)
  }
  return result
}
