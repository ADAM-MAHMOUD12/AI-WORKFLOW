export type RoomFootprint = {
  x: number
  y: number
  width: number
  height: number
  polygon?: [number, number][]
}

export type NamedRoomFootprint = RoomFootprint & { name: string }

export type RectangularFootprint = {
  x: number
  y: number
  width: number
  height: number
}

export type PlanOpening = {
  x: number
  y: number
  width?: number
  rotation?: number
}

export type CirculationRoom = RoomFootprint & { name: string }

export type PlacedPlanOpening = {
  wallIndex: number
  x: number
  y: number
  width: number
  offset: number
  rotation: number
}

export type PlanWallSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
  height?: number
  thickness?: number
}

type Point = { x: number; y: number }
type Edge = { a: Point; b: Point; lengthSquared: number }

const GEOMETRY_EPSILON = 1e-7
const ALIGNMENT_TOLERANCE = 0.005
const OPENING_ANGLE_TOLERANCE = 30

function pointsForRoom(room: RoomFootprint): Point[] {
  if (room.polygon) {
    return room.polygon.map(([x, y]) => ({ x, y }))
  }
  return [
    { x: room.x, y: room.y },
    { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height },
    { x: room.x, y: room.y + room.height },
  ]
}

function polygonArea(points: readonly Point[]): number {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point.x * next.y - next.x * point.y
  }, 0)) / 2
}

function horizontalIntervals(points: readonly Point[], x: number): Array<[number, number]> {
  const intersections: number[] = []
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    if ((a.x <= x && x < b.x) || (b.x <= x && x < a.x)) {
      intersections.push(a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x))
    }
  }
  intersections.sort((a, b) => a - b)
  const intervals: Array<[number, number]> = []
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    intervals.push([intersections[index], intersections[index + 1]])
  }
  return intervals
}

function intersectionX(first: Edge, second: Edge): number | undefined {
  const rx = first.b.x - first.a.x
  const ry = first.b.y - first.a.y
  const sx = second.b.x - second.a.x
  const sy = second.b.y - second.a.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return undefined

  const qpx = second.a.x - first.a.x
  const qpy = second.a.y - first.a.y
  const t = (qpx * sy - qpy * sx) / denominator
  const u = (qpx * ry - qpy * rx) / denominator
  if (t <= GEOMETRY_EPSILON || t >= 1 - GEOMETRY_EPSILON || u <= GEOMETRY_EPSILON || u >= 1 - GEOMETRY_EPSILON) {
    return undefined
  }
  return first.a.x + t * rx
}

function roomEdges(rooms: readonly RoomFootprint[]): Edge[] {
  return rooms.flatMap((room) => {
    const points = pointsForRoom(room)
    return points.flatMap((a, index) => {
      const b = points[(index + 1) % points.length]
      const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
      return lengthSquared <= GEOMETRY_EPSILON ? [] : [{ a, b, lengthSquared }]
    })
  })
}

function project(point: Point, edge: Edge): number {
  return ((point.x - edge.a.x) * (edge.b.x - edge.a.x) + (point.y - edge.a.y) * (edge.b.y - edge.a.y)) / edge.lengthSquared
}

function perpendicularDistance(point: Point, edge: Edge): number {
  const dx = edge.b.x - edge.a.x
  const dy = edge.b.y - edge.a.y
  return Math.abs(dx * (point.y - edge.a.y) - dy * (point.x - edge.a.x)) / Math.sqrt(edge.lengthSquared)
}

function pointOnEdge(point: Point, edge: Edge): boolean {
  const t = project(point, edge)
  return t >= -GEOMETRY_EPSILON && t <= 1 + GEOMETRY_EPSILON && perpendicularDistance(point, edge) <= ALIGNMENT_TOLERANCE
}

function segmentKey(a: Point, b: Point): string {
  const points = [a, b]
    .map((point) => [Math.round(point.x * 1000), Math.round(point.y * 1000)])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
  return points.map((point) => point.join(',')).join(':')
}

function angleDifference(first: number, second: number): number {
  const difference = Math.abs(((first - second + 90) % 180 + 180) % 180 - 90)
  return difference
}

function roomIsServiceSpace(name: string): boolean {
  return /bath|bathroom|toilet|wc|laundry|utility|حمام|مرحاض|دورة مياه|غسيل|خدمات/i.test(name)
}

function roomIsCirculation(name: string): boolean {
  return /hall|corridor|circulation|ممر|ردهة|طرقة/i.test(name)
}

function roomIsLivingSpace(name: string): boolean {
  return /living|lounge|salon|معيشة|صالة|مجلس/i.test(name)
}

type SharedRoomEdge = {
  first: number
  second: number
  x: number
  y: number
  rotation: number
  length: number
}

function sharedRoomEdge(first: Edge, second: Edge, firstIndex: number, secondIndex: number): SharedRoomEdge | undefined {
  const firstLength = Math.sqrt(first.lengthSquared)
  const secondLength = Math.sqrt(second.lengthSquared)
  const ux = (first.b.x - first.a.x) / firstLength
  const uy = (first.b.y - first.a.y) / firstLength
  const vx = (second.b.x - second.a.x) / secondLength
  const vy = (second.b.y - second.a.y) / secondLength
  if (Math.abs(ux * vy - uy * vx) > 0.001) return undefined

  const lineDistance = Math.abs(ux * (second.a.y - first.a.y) - uy * (second.a.x - first.a.x))
  if (lineDistance > 0.02) return undefined

  const firstStart = 0
  const firstEnd = firstLength
  const secondStart = (second.a.x - first.a.x) * ux + (second.a.y - first.a.y) * uy
  const secondEnd = (second.b.x - first.a.x) * ux + (second.b.y - first.a.y) * uy
  const start = Math.max(firstStart, Math.min(secondStart, secondEnd))
  const end = Math.min(firstEnd, Math.max(secondStart, secondEnd))
  if (end - start < 0.81) return undefined

  const offset = (start + end) / 2
  return {
    first: firstIndex,
    second: secondIndex,
    x: first.a.x + ux * offset,
    y: first.a.y + uy * offset,
    rotation: Math.atan2(uy, ux) * 180 / Math.PI,
    length: end - start,
  }
}

/** Builds a connected door layout with an exterior entry in a habitable room, never a bathroom. */
export function buildCirculationDoors(rooms: readonly CirculationRoom[], units: 'm' | 'cm' = 'm'): PlanOpening[] {
  if (rooms.length === 0) return []
  const scale = units === 'cm' ? 100 : 1
  const edges = rooms.map((room) => {
    const points = pointsForRoom(room)
    return points.flatMap((a, index) => {
      const b = points[(index + 1) % points.length]
      const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
      return lengthSquared <= GEOMETRY_EPSILON ? [] : [{ a, b, lengthSquared }]
    })
  })
  const links = rooms.flatMap((_, firstIndex) =>
    rooms.slice(firstIndex + 1).flatMap((_, offset) => {
      const secondIndex = firstIndex + offset + 1
      return edges[firstIndex].flatMap((firstEdge) => edges[secondIndex]
        .map((secondEdge) => sharedRoomEdge(firstEdge, secondEdge, firstIndex, secondIndex))
        .filter((edge): edge is SharedRoomEdge => edge !== undefined))
    }),
  )

  const allPoints = rooms.flatMap(pointsForRoom)
  const minX = Math.min(...allPoints.map((point) => point.x))
  const maxX = Math.max(...allPoints.map((point) => point.x))
  const minY = Math.min(...allPoints.map((point) => point.y))
  const maxY = Math.max(...allPoints.map((point) => point.y))
  const exteriorEdges = edges.map((roomEdges) => roomEdges.filter((edge) => {
    const onVerticalBoundary = Math.abs(edge.a.x - edge.b.x) <= ALIGNMENT_TOLERANCE
      && (Math.abs(edge.a.x - minX) <= ALIGNMENT_TOLERANCE || Math.abs(edge.a.x - maxX) <= ALIGNMENT_TOLERANCE)
    const onHorizontalBoundary = Math.abs(edge.a.y - edge.b.y) <= ALIGNMENT_TOLERANCE
      && (Math.abs(edge.a.y - minY) <= ALIGNMENT_TOLERANCE || Math.abs(edge.a.y - maxY) <= ALIGNMENT_TOLERANCE)
    return onVerticalBoundary || onHorizontalBoundary
  }))

  const possibleEntrances = rooms.flatMap((room, index) => {
    if (roomIsServiceSpace(room.name) || exteriorEdges[index].length === 0) return []
    const perimeter = exteriorEdges[index]
      .filter((edge) => Math.sqrt(edge.lengthSquared) >= 0.8)
      .reduce((total, edge) => total + Math.sqrt(edge.lengthSquared), 0)
    if (perimeter === 0) return []
    const preference = roomIsLivingSpace(room.name) ? 2 : roomIsCirculation(room.name) ? 1 : 0
    return [{ index, perimeter, preference }]
  }).sort((a, b) => b.preference - a.preference || b.perimeter - a.perimeter)

  const doors: PlanOpening[] = []
  const root = possibleEntrances[0]
  if (root) {
    const edge = exteriorEdges[root.index]
      .filter((candidate) => Math.sqrt(candidate.lengthSquared) >= 0.8)
      .sort((a, b) => b.lengthSquared - a.lengthSquared)[0]
    if (!edge) return []
    doors.push({
      x: (edge.a.x + edge.b.x) / 2,
      y: (edge.a.y + edge.b.y) / 2,
      width: Math.min(1, Math.sqrt(edge.lengthSquared) - 0.2) * scale,
      rotation: Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x) * 180 / Math.PI,
    })
  }

  const connected = new Set(root ? [root.index] : [])
  while (connected.size > 0 && connected.size < rooms.length) {
    const options = links.filter((link) => connected.has(link.first) !== connected.has(link.second))
      .map((link) => {
        const newRoom = connected.has(link.first) ? link.second : link.first
        const circulationBonus = Number(roomIsCirculation(rooms[link.first].name) || roomIsCirculation(rooms[link.second].name))
        const servicePenalty = Number(roomIsServiceSpace(rooms[newRoom].name)) * 0.2
        return { link, newRoom, score: link.length + circulationBonus * 2 - servicePenalty }
      })
      .sort((a, b) => b.score - a.score)
    const next = options[0]
    if (!next) break
    doors.push({
      x: next.link.x,
      y: next.link.y,
      width: Math.min(0.9, next.link.length - 0.2) * scale,
      rotation: next.link.rotation,
    })
    connected.add(next.newRoom)
  }
  return doors.filter((door) => (door.width ?? 0) >= 0.6 * scale)
}

/** Projects opening centers onto the best available wall, adapting to constrained plans. */
export function placeOpeningsOnWalls(
  openings: readonly PlanOpening[],
  walls: readonly PlanWallSegment[],
  units: 'm' | 'cm' = 'm',
  defaultWidth = 0.9,
): PlacedPlanOpening[] {
  const scale = units === 'cm' ? 100 : 1
  const endpointClearance = 0.1 * scale
  const occupied = new Map<number, Array<[number, number]>>()

  return openings.map((opening, openingIndex) => {
    const width = opening.width ?? defaultWidth * scale
    if (![opening.x, opening.y, width].every(Number.isFinite) || width <= 0) {
      throw new Error(`Opening ${openingIndex + 1} has invalid geometry.`)
    }

    const candidates: Array<PlacedPlanOpening & { tier: number; aligned: boolean; distance: number }> = []
    for (let wallIndex = 0; wallIndex < walls.length; wallIndex += 1) {
      const wall = walls[wallIndex]
      const dx = wall.x2 - wall.x1
      const dy = wall.y2 - wall.y1
      const length = Math.hypot(dx, dy)
      if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) continue

      const rotation = Math.atan2(dy, dx) * 180 / Math.PI
      const angularDifference = opening.rotation === undefined ? 0 : angleDifference(rotation, opening.rotation)
      const aligned = opening.rotation === undefined || angularDifference <= OPENING_ANGLE_TOLERANCE
      const rawOffset = ((opening.x - wall.x1) * dx + (opening.y - wall.y1) * dy) / length
      const desiredOffset = Math.max(0, Math.min(length, rawOffset))
      const intervals = occupied.get(wallIndex) ?? []

      const addCandidate = (tier: number, clearance: number, avoidOccupied: boolean, allowNarrowing: boolean) => {
        const start = clearance
        const end = length - clearance
        if (end <= start) return

        const blocked = avoidOccupied
          ? intervals.map(([from, to]) => [Math.max(start, from - clearance), Math.min(end, to + clearance)] as [number, number])
          : []
        const gaps: Array<[number, number]> = []
        let cursor = start
        for (const [from, to] of blocked.sort((a, b) => a[0] - b[0])) {
          if (from > cursor) gaps.push([cursor, from])
          cursor = Math.max(cursor, to)
        }
        if (cursor < end) gaps.push([cursor, end])

        for (const [gapStart, gapEnd] of gaps) {
          const gapWidth = gapEnd - gapStart
          const placedWidth = allowNarrowing ? Math.min(width, gapWidth) : width
          if (placedWidth <= GEOMETRY_EPSILON || placedWidth > gapWidth + GEOMETRY_EPSILON) continue
          const offset = Math.max(gapStart + placedWidth / 2, Math.min(gapEnd - placedWidth / 2, desiredOffset))
          const x = wall.x1 + (offset / length) * dx
          const y = wall.y1 + (offset / length) * dy
          candidates.push({
            wallIndex, x, y, width: placedWidth, offset, rotation,
            tier, aligned, distance: Math.hypot(x - opening.x, y - opening.y) + angularDifference / 180 * 0.02,
          })
        }
      }

      addCandidate(0, endpointClearance, true, false)
      addCandidate(1, 0, true, false)
      addCandidate(2, endpointClearance, true, true)
      addCandidate(3, 0, true, true)
      // If the plan has no free wall interval left, keep it loadable by allowing overlap.
      addCandidate(4, 0, false, true)
    }

    const best = candidates.sort((a, b) =>
      a.tier - b.tier
      || b.width - a.width
      || Number(b.aligned) - Number(a.aligned)
      || a.distance - b.distance,
    )[0]
    if (!best) {
      const orientation = opening.rotation === undefined ? '' : ` at ${opening.rotation}°`
      throw new Error(`Opening ${openingIndex + 1}${orientation} cannot be placed because the plan has no usable wall.`)
    }
    const intervals = occupied.get(best.wallIndex) ?? []
    intervals.push([best.offset - best.width / 2, best.offset + best.width / 2])
    occupied.set(best.wallIndex, intervals)
    return {
      wallIndex: best.wallIndex,
      x: best.x,
      y: best.y,
      width: best.width,
      offset: best.offset,
      rotation: best.rotation,
    }
  })
}

function wallAlignmentTolerance(wall: PlanWallSegment): number {
  return Math.max(ALIGNMENT_TOLERANCE, Math.max(0, wall.thickness ?? 0.12) / 2 + 0.02)
}

function sourceWallForSegment(a: Point, b: Point, walls: readonly PlanWallSegment[]): PlanWallSegment | undefined {
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  let match: { wall: PlanWallSegment; distance: number } | undefined

  for (const wall of walls) {
    const wallEdge: Edge = {
      a: { x: wall.x1, y: wall.y1 },
      b: { x: wall.x2, y: wall.y2 },
      lengthSquared: (wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2,
    }
    if (wallEdge.lengthSquared <= GEOMETRY_EPSILON) continue
    const wallLength = Math.sqrt(wallEdge.lengthSquared)
    const parallel = Math.abs(dx * (wall.y2 - wall.y1) - dy * (wall.x2 - wall.x1)) / (length * wallLength)
    if (parallel > 0.001) continue
    const distance = perpendicularDistance(midpoint, wallEdge)
    if (distance > wallAlignmentTolerance(wall)) continue
    const t = project(midpoint, wallEdge)
    if (t < -GEOMETRY_EPSILON || t > 1 + GEOMETRY_EPSILON) continue
    if (!match || distance < match.distance) match = { wall, distance }
  }
  return match?.wall
}

function projectToWall(point: Point, wall: PlanWallSegment): Point {
  const dx = wall.x2 - wall.x1
  const dy = wall.y2 - wall.y1
  const lengthSquared = dx * dx + dy * dy
  const t = ((point.x - wall.x1) * dx + (point.y - wall.y1) * dy) / lengthSquared
  const projected = { x: wall.x1 + t * dx, y: wall.y1 + t * dy }
  const tolerance = wallAlignmentTolerance(wall)
  if (Math.hypot(projected.x - wall.x1, projected.y - wall.y1) <= tolerance) return { x: wall.x1, y: wall.y1 }
  if (Math.hypot(projected.x - wall.x2, projected.y - wall.y2) <= tolerance) return { x: wall.x2, y: wall.y2 }
  return projected
}

/** Makes one joined wall graph from room boundaries, splitting shared and T-junction edges once. */
export function deriveWallsFromRooms(
  rooms: readonly RoomFootprint[],
  sourceWalls: readonly PlanWallSegment[],
  units: 'm' | 'cm' = 'm',
): PlanWallSegment[] {
  const edges = roomEdges(rooms)
  const result: PlanWallSegment[] = []
  const seen = new Set<string>()
  const defaultThickness = units === 'cm' ? 12 : 0.12
  const exteriorThickness = units === 'cm' ? 18 : 0.18
  const defaultHeight = units === 'cm' ? 280 : 2.8

  for (const edge of edges) {
    const cuts = [0, 1]
    for (const other of edges) {
      for (const endpoint of [other.a, other.b]) {
        if (perpendicularDistance(endpoint, edge) > ALIGNMENT_TOLERANCE) continue
        const t = project(endpoint, edge)
        if (t > GEOMETRY_EPSILON && t < 1 - GEOMETRY_EPSILON) cuts.push(t)
      }
    }
    for (const wall of sourceWalls) {
      const wallEdge: Edge = {
        a: { x: wall.x1, y: wall.y1 },
        b: { x: wall.x2, y: wall.y2 },
        lengthSquared: (wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2,
      }
      if (wallEdge.lengthSquared <= GEOMETRY_EPSILON) continue
      for (const endpoint of [wallEdge.a, wallEdge.b]) {
        if (perpendicularDistance(endpoint, edge) > wallAlignmentTolerance(wall)) continue
        const t = project(endpoint, edge)
        if (t > GEOMETRY_EPSILON && t < 1 - GEOMETRY_EPSILON) cuts.push(t)
      }
    }
    cuts.sort((a, b) => a - b)
    const uniqueCuts = cuts.filter((value, index) => index === 0 || value - cuts[index - 1] > GEOMETRY_EPSILON)

    for (let index = 0; index < uniqueCuts.length - 1; index += 1) {
      const start = uniqueCuts[index]
      const end = uniqueCuts[index + 1]
      if (end - start <= GEOMETRY_EPSILON) continue
      let a = {
        x: edge.a.x + (edge.b.x - edge.a.x) * start,
        y: edge.a.y + (edge.b.y - edge.a.y) * start,
      }
      let b = {
        x: edge.a.x + (edge.b.x - edge.a.x) * end,
        y: edge.a.y + (edge.b.y - edge.a.y) * end,
      }
      const sourceWall = sourceWallForSegment(a, b, sourceWalls)
      if (sourceWall) {
        a = projectToWall(a, sourceWall)
        b = projectToWall(b, sourceWall)
      }
      const key = segmentKey(a, b)
      if (seen.has(key)) continue
      seen.add(key)

      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const adjoiningRooms = edges.filter((candidate) => pointOnEdge(midpoint, candidate)).length
      result.push({
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        height: sourceWall?.height ?? defaultHeight,
        thickness: sourceWall?.thickness ?? (adjoiningRooms > 1 ? defaultThickness : exteriorThickness),
      })
    }
  }
  return result
}

/** Checks room footprints for missing floor area or overlapping rooms. */
export function roomLayoutIssues(rooms: readonly RoomFootprint[]): string[] {
  if (rooms.length === 0) return []
  const valid = rooms.filter((room) => {
    if (![room.x, room.y, room.width, room.height].every(Number.isFinite) || room.width <= 0 || room.height <= 0) return false
    const points = pointsForRoom(room)
    return points.length >= 3 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) &&
      polygonArea(points) > GEOMETRY_EPSILON
  })
  if (valid.length !== rooms.length) return ['غرف المخطط تحتوي على أبعاد أو حدود غير صالحة.']

  const polygons = valid.map(pointsForRoom)
  const xValues = polygons.flatMap((polygon) => polygon.map((point) => point.x))
  const polygonEdges = polygons.map((polygon) => polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length]
    return { a, b, lengthSquared: (b.x - a.x) ** 2 + (b.y - a.y) ** 2 }
  }))
  for (let first = 0; first < polygonEdges.length; first += 1) {
    for (let second = first + 1; second < polygonEdges.length; second += 1) {
      for (const a of polygonEdges[first]) {
        for (const b of polygonEdges[second]) {
          const x = intersectionX(a, b)
          if (x !== undefined) xValues.push(x)
        }
      }
    }
  }
  const xCoordinates = [...new Set(xValues)].sort((a, b) => a - b)
  let unionArea = 0
  let summedArea = 0
  for (let index = 0; index < xCoordinates.length - 1; index += 1) {
    const left = xCoordinates[index]
    const right = xCoordinates[index + 1]
    if (right - left <= GEOMETRY_EPSILON) continue
    const intervals = polygons.flatMap((polygon) => horizontalIntervals(polygon, (left + right) / 2))
      .sort((a, b) => a[0] - b[0])
    let unionHeight = 0
    let spanStart: number | undefined
    let spanEnd = 0
    let totalHeight = 0
    for (const [start, end] of intervals) {
      totalHeight += end - start
      if (spanStart === undefined) {
        spanStart = start
        spanEnd = end
      } else if (start <= spanEnd) {
        spanEnd = Math.max(spanEnd, end)
      } else {
        unionHeight += spanEnd - spanStart
        spanStart = start
        spanEnd = end
      }
    }
    if (spanStart !== undefined) unionHeight += spanEnd - spanStart
    unionArea += (right - left) * unionHeight
    summedArea += (right - left) * totalHeight
  }

  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...polygons.flatMap((polygon) => polygon.map((point) => point.y)))
  const maxY = Math.max(...polygons.flatMap((polygon) => polygon.map((point) => point.y)))
  const envelopeArea = (maxX - minX) * (maxY - minY)
  if (envelopeArea <= 0) return ['مساحة المخطط يجب أن تكون أكبر من صفر.']

  const coverage = unionArea / envelopeArea
  const overlap = Math.max(0, summedArea - unionArea) / envelopeArea
  const minimumCoverage = valid.some((room) => room.polygon) ? 0.95 : 0.97
  const issues: string[] = []
  if (coverage < minimumCoverage) {
    issues.push(`الغرف تغطي ${Math.round(coverage * 100)}٪ فقط من مساحة المبنى؛ سمِّ المساحة المتبقية ممراً أو غرفة بدلاً من تركها فراغاً.`)
  }
  if (overlap > 0.005) {
    issues.push(`الغرف متداخلة بمساحة تقارب ${Math.round(overlap * 100)}٪ من مساحة المبنى؛ أزل التداخل قبل اعتماد المخطط.`)
  }
  return issues
}

/** Rebuilds invalid text-generated room coordinates as a named, non-overlapping row layout. */
export function tileRoomsIntoFootprint(
  rooms: readonly NamedRoomFootprint[],
  footprint: RectangularFootprint,
): NamedRoomFootprint[] | null {
  if (rooms.length < 2 || ![footprint.x, footprint.y, footprint.width, footprint.height].every(Number.isFinite) ||
    footprint.width <= 0 || footprint.height <= 0 || Math.max(footprint.width, footprint.height) / Math.min(footprint.width, footprint.height) > 4) {
    return null
  }

  const rows: NamedRoomFootprint[][] = [[], [], []]
  const weights = new Map<NamedRoomFootprint, number>()
  for (const room of rooms) {
    const name = room.name.toLocaleLowerCase()
    let row = 2
    let weight = 0.12
    if (/bed|bedroom|غرفة\s*نوم|نوم/.test(name)) {
      row = 0
      weight = 0.15
    } else if (/living|lounge|family|معيشة|صالة|مجلس/.test(name)) {
      row = 1
      weight = 0.24
    } else if (/kitchen|مطبخ/.test(name)) {
      row = 1
      weight = 0.12
    } else if (/bath|toilet|washroom|\bwc\b|حمام|مرحاض/.test(name)) {
      weight = 0.07
    } else if (/hall|corridor|passage|ممر|ردهة/.test(name)) {
      weight = 0.08
    }
    rows[row].push(room)
    weights.set(room, weight)
  }

  const activeRows = rows.filter((row) => row.length > 0)
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  let rowY = footprint.y
  const tiled: NamedRoomFootprint[] = []
  for (let rowIndex = 0; rowIndex < activeRows.length; rowIndex += 1) {
    const row = activeRows[rowIndex]
    const rowWeight = row.reduce((sum, room) => sum + weights.get(room)!, 0)
    const rowHeight = rowIndex === activeRows.length - 1
      ? footprint.y + footprint.height - rowY
      : footprint.height * rowWeight / totalWeight
    let x = footprint.x
    for (let roomIndex = 0; roomIndex < row.length; roomIndex += 1) {
      const room = row[roomIndex]
      const width = roomIndex === row.length - 1
        ? footprint.x + footprint.width - x
        : footprint.width * weights.get(room)! / rowWeight
      if (width < 1.2 || rowHeight < 1.8) return null
      tiled.push({ ...room, x, y: rowY, width, height: rowHeight, polygon: undefined })
      x += width
    }
    rowY += rowHeight
  }

  return roomLayoutIssues(tiled).length === 0 ? tiled : null
}
