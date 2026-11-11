import type { Position } from 'geojson'

function at([x1, y1, t1]: Position, [x2, y2, t2]: Position, time: number): Position {
  const f = (time - t1) / (t2 - t1)
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, time]
}

/** The parts of a track ridden between `from` and `to` seconds, from the times in the third coordinate */
export function linesBetween(lines: Position[][], from: number, to: number): Position[][] {
  const result: Position[][] = []
  for (const line of lines) {
    const part: Position[] = []
    for (let i = 0; i < line.length; i++) {
      const point = line[i]
      const previous = line[i - 1]
      if (previous && previous[2] < from && point[2] > from) part.push(at(previous, point, from))
      if (point[2] >= from && point[2] <= to) part.push(point)
      if (previous && previous[2] < to && point[2] > to) part.push(at(previous, point, to))
    }
    if (part.length >= 2) result.push(part)
  }
  return result
}

/** Points along a line of [lon, lat] about every `step` km, including its first point */
export function pointsAlong(line: Position[], step: number): Position[] {
  const points: Position[] = []
  // Kilometers per degree; the latitude hardly changes within a city
  const ky = 111.32
  const kx = ky * Math.cos((line[0][1] * Math.PI) / 180)
  let carry = 0
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1]
    const [x2, y2] = line[i]
    const length = Math.hypot((x2 - x1) * kx, (y2 - y1) * ky)
    for (let d = carry; d < length; d += step) points.push([x1 + ((x2 - x1) * d) / length, y1 + ((y2 - y1) * d) / length])
    carry = (carry - length) % step
    if (carry < 0) carry += step
  }
  const [x, y] = line.at(-1)!
  points.push([x, y])
  return points
}
