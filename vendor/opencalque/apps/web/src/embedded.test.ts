import { describe, expect, it } from 'vitest'
import { buildCirculationDoors, deriveWallsFromRooms, placeOpeningsOnWalls, roomLayoutIssues, tileRoomsIntoFootprint } from './architectural-plan-geometry'
import { documentFromPlan, planFromDocument } from './embedded'

describe('AI TaskFlow floor-plan bridge', () => {
  it('round-trips joined walls, named rooms, doors, and windows in metres', () => {
    const plan = {
      title: 'Two rooms',
      units: 'm' as const,
      walls: [
        { x1: 0, y1: 0, x2: 8, y2: 0 },
        { x1: 8, y1: 0, x2: 8, y2: 5 },
        { x1: 8, y1: 5, x2: 0, y2: 5 },
        { x1: 0, y1: 5, x2: 0, y2: 0 },
        { x1: 4, y1: 0, x2: 4, y2: 5 },
      ],
      rooms: [
        { name: 'Living room', x: 0.2, y: 0.2, width: 3.6, height: 4.6 },
        { name: 'Bedroom', x: 3.8, y: 0.2, width: 4, height: 4.6 },
      ],
      doors: [{ x: 1, y: 0, width: 0.9 }],
      windows: [{ x: 5.5, y: 0, width: 1.2 }],
    }

    const roundTrip = planFromDocument(documentFromPlan(plan))

    expect(roundTrip.walls).toHaveLength(7)
    expect(roundTrip.rooms?.map((room) => room.name)).toEqual(['Living room', 'Bedroom'])
    expect(roundTrip.doors).toHaveLength(1)
    expect(roundTrip.doors?.[0].width).toBeCloseTo(0.9)
    expect(roundTrip.windows).toHaveLength(1)
    expect(roundTrip.windows?.[0].width).toBeCloseTo(1.2)
    expect(roundTrip.rooms?.[0].polygon).toHaveLength(4)
  })

  it('adds missing rectangular room partitions without duplicating existing exterior walls', () => {
    const plan = {
      title: 'Partition',
      units: 'm' as const,
      walls: [
        { x1: 0, y1: 0, x2: 6, y2: 0 },
        { x1: 6, y1: 0, x2: 6, y2: 4 },
        { x1: 6, y1: 4, x2: 0, y2: 4 },
        { x1: 0, y1: 4, x2: 0, y2: 0 },
      ],
      rooms: [{ name: 'Office', x: 1, y: 1, width: 3, height: 2 }],
    }

    const roundTrip = planFromDocument(documentFromPlan(plan))

    expect(roundTrip.walls).toHaveLength(4)
    expect(roundTrip.rooms?.map((room) => room.name)).toEqual(['Office'])
  })

  it('builds one continuous wall at shared room boundaries instead of boxed duplicate walls', () => {
    const walls = deriveWallsFromRooms([
      { x: 0, y: 0, width: 4, height: 3 },
      { x: 4, y: 0, width: 4, height: 3 },
    ], [])

    expect(walls).toHaveLength(7)
    expect(walls.filter((wall) => wall.x1 === 4 && wall.x2 === 4 && wall.y1 === 0 && wall.y2 === 3)).toHaveLength(1)
  })

  it('snaps inset room boundaries back to one shared wall centerline', () => {
    const walls = deriveWallsFromRooms([
      { x: 0, y: 0, width: 4, height: 3 },
      { x: 4.12, y: 0.06, width: 4, height: 2.88 },
    ], [{ x1: 4.06, y1: 0, x2: 4.06, y2: 3, thickness: 0.12 }])

    expect(walls.filter((wall) => Math.abs(wall.x1 - 4.06) < 0.001 && Math.abs(wall.x2 - 4.06) < 0.001)).toHaveLength(1)
    expect(walls.find((wall) => Math.abs(wall.x1 - 4.06) < 0.001 && Math.abs(wall.x2 - 4.06) < 0.001)).toMatchObject({ y1: 0, y2: 3 })
    expect(walls.some((wall) => wall.x1 === 4 && wall.x2 === 4)).toBe(false)
    expect(walls.some((wall) => wall.x1 === 4.12 && wall.x2 === 4.12)).toBe(false)
  })

  it('rejects uncovered or overlapping layouts before they can become a 3D plan', () => {
    expect(roomLayoutIssues([
      { x: 0, y: 0, width: 3, height: 3 },
      { x: 4, y: 0, width: 3, height: 3 },
    ]).join(' ')).toContain('تغطي')

    expect(roomLayoutIssues([
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 3, y: 0, width: 4, height: 4 },
    ]).join(' ')).toContain('متداخلة')
  })

  it('validates actual polygon coverage and overlap instead of trusting bounding boxes', () => {
    expect(roomLayoutIssues([
      { name: 'L-shaped space', x: 0, y: 0, width: 4, height: 4, polygon: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]] },
    ]).join(' ')).toContain('تغطي')

    expect(roomLayoutIssues([
      { name: 'First', x: 0, y: 0, width: 4, height: 4, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { name: 'Second', x: 2, y: 0, width: 4, height: 4, polygon: [[2, 0], [6, 0], [6, 4], [2, 4]] },
    ]).join(' ')).toContain('متداخلة')
  })

  it('allows narrow polygon gaps consistent with interior wall thickness', () => {
    expect(roomLayoutIssues([
      { x: 0, y: 0, width: 1.94, height: 2, polygon: [[0, 0], [1.94, 0], [1.94, 2], [0, 2]] },
      { x: 2.06, y: 0, width: 1.94, height: 2, polygon: [[2.06, 0], [4, 0], [4, 2], [2.06, 2]] },
    ])).toEqual([])
  })

  it('rejects malformed or zero-area room boundaries', () => {
    expect(roomLayoutIssues([
      { name: 'Invalid', x: 0, y: 0, width: 4, height: 4, polygon: [[0, 0], [1, 1]] },
    ]).join(' ')).toContain('غير صالحة')
  })

  it('repairs invalid text-generated apartment coordinates into a complete named tiling', () => {
    const rooms = [
      { name: 'غرفة نوم 1', x: 0, y: 0, width: 5.5, height: 5 },
      { name: 'غرفة نوم 2', x: 5.5, y: 0, width: 5.5, height: 5 },
      { name: 'صالة', x: 0, y: 5, width: 11, height: 5 },
      { name: 'مطبخ', x: 0, y: 5, width: 5.5, height: 5 },
      { name: 'حمام 1', x: 5.5, y: 5, width: 2.75, height: 2.5 },
      { name: 'حمام 2', x: 8.25, y: 5, width: 2.75, height: 2.5 },
      { name: 'ممر', x: 0, y: 14.5, width: 11, height: 0.5 },
    ]

    const repaired = tileRoomsIntoFootprint(rooms, { x: 0, y: 0, width: 11, height: 10 })

    expect(repaired).not.toBeNull()
    expect(repaired?.map((room) => room.name)).toEqual(rooms.map((room) => room.name))
    expect(roomLayoutIssues(repaired ?? [])).toEqual([])
    expect(Math.max(...(repaired ?? []).map((room) => room.y + room.height))).toBeCloseTo(10)
    expect(repaired?.find((room) => room.name === 'ممر')?.y).toBeGreaterThan(0)
  })

  it('does not reflow plans into an implausibly narrow footprint', () => {
    expect(tileRoomsIntoFootprint([
      { name: 'Room A', x: 0, y: 0, width: 1, height: 1 },
      { name: 'Room B', x: 0, y: 0, width: 1, height: 1 },
    ], { x: 0, y: 0, width: 1, height: 20 })).toBeNull()
  })

  it('creates a habitable exterior entry and a connected interior door for every room', () => {
    const rooms = [
      { name: 'Living room', x: 0.18, y: 0.18, width: 7.64, height: 5 },
      { name: 'Main bedroom', x: 7.82, y: 0.18, width: 3, height: 5 },
      { name: 'Kitchen', x: 0.18, y: 5.18, width: 5, height: 4.64 },
      { name: 'Bathroom', x: 5.18, y: 5.18, width: 2.64, height: 2.32 },
      { name: 'Bedroom 2', x: 7.82, y: 5.18, width: 3, height: 4.64 },
      { name: 'Hall', x: 5.18, y: 7.5, width: 2.64, height: 2.32 },
    ]
    const doors = buildCirculationDoors(rooms)

    expect(doors).toHaveLength(rooms.length)
    expect(doors[0].x).toBeGreaterThan(0.18)
    expect(doors[0].x).toBeLessThan(7.82)
    expect(doors[0].y).toBeCloseTo(0.18)
    expect(doors.some((door) => Math.abs(door.y - 7.5) < 0.01 && door.x > 5.18 && door.x < 7.82)).toBe(true)
    expect(doors.every((door) => (door.width ?? 0) >= 0.6)).toBe(true)
  })

  it('uses the opening rotation to choose the intended wall at a junction', () => {
    const placed = placeOpeningsOnWalls([
      { x: 5.5, y: 5, width: 0.9, rotation: 0 },
    ], [
      { x1: 0, y1: 5, x2: 11, y2: 5 },
      { x1: 5.5, y1: 0, x2: 5.5, y2: 10 },
    ])

    expect(placed[0]).toMatchObject({ wallIndex: 0, x: 5.5, y: 5, offset: 5.5, rotation: 0 })
  })

  it('falls back to the nearest wall when the supplied rotation is inaccurate', () => {
    const placed = placeOpeningsOnWalls([
      { x: 5, y: 5, width: 0.9, rotation: 0 },
    ], [{ x1: 5, y1: 0, x2: 5, y2: 10 }])

    expect(placed[0]).toMatchObject({ wallIndex: 0, x: 5, y: 5, rotation: 90 })
  })

  it('places both doors in the default apartment on their intended shared walls', () => {
    const rooms = [
      { x: 0.18, y: 0.18, width: 7.64, height: 5 },
      { x: 7.82, y: 0.18, width: 3, height: 5 },
      { x: 0.18, y: 5.18, width: 5, height: 4.64 },
      { x: 5.18, y: 5.18, width: 2.64, height: 2.32 },
      { x: 7.82, y: 5.18, width: 3, height: 4.64 },
      { x: 5.18, y: 7.5, width: 2.64, height: 2.32 },
    ]
    const walls = [
      { x1: 0.18, y1: 0.18, x2: 10.82, y2: 0.18 },
      { x1: 10.82, y1: 0.18, x2: 10.82, y2: 9.82 },
      { x1: 10.82, y1: 9.82, x2: 0.18, y2: 9.82 },
      { x1: 0.18, y1: 9.82, x2: 0.18, y2: 0.18 },
    ]
    const inputWalls = deriveWallsFromRooms(rooms, walls)
    const placed = placeOpeningsOnWalls([
      { x: 1, y: 5.18, width: 1 },
      { x: 7.82, y: 2, width: 0.9 },
      { x: 2, y: 0.18, width: 1.8 },
      { x: 9, y: 9.82, width: 1.8 },
    ], inputWalls)

    expect(placed[0].y).toBeCloseTo(5.18)
    expect(placed[1].x).toBeCloseTo(7.82)
    expect(placed[1].y).toBeCloseTo(2)
    const doc = documentFromPlan({
      title: 'Default apartment',
      units: 'm',
      walls,
      rooms,
      doors: [{ x: 1, y: 5.18, width: 1 }, { x: 7.82, y: 2, width: 0.9 }],
      windows: [{ x: 2, y: 0.18, width: 1.8 }, { x: 9, y: 9.82, width: 1.8 }],
    })
    expect(Object.values(doc.nodes).filter((node) => node.type === 'parametric' && node.kind === 'arch.door')).toHaveLength(2)
  })

  it('keeps the complete opening and corner clearance on the selected wall', () => {
    const placed = placeOpeningsOnWalls([
      { x: 0.1, y: 2, width: 1, rotation: 0 },
    ], [{ x1: 0, y1: 2, x2: 5, y2: 2 }])

    expect(placed[0].offset).toBeCloseTo(0.6)
    expect(placed[0].offset - placed[0].width / 2).toBeCloseTo(0.1)
  })

  it('reduces oversized openings and projects distant openings onto available walls', () => {
    const narrowWall = placeOpeningsOnWalls([
      { x: 5, y: 5, width: 1.2, rotation: 0 },
    ], [{ x1: 5, y1: 0, x2: 5, y2: 1 }])
    expect(narrowWall[0].width).toBeCloseTo(0.8)
    expect(narrowWall[0].y).toBeCloseTo(0.5)

    const distant = placeOpeningsOnWalls([
      { x: 5, y: 5, width: 0.9, rotation: 0 },
    ], [{ x1: 0, y1: 0, x2: 10, y2: 0 }])
    expect(distant[0].x).toBeCloseTo(5)
    expect(distant[0].y).toBeCloseTo(0)
  })

  it('respects centimetre dimensions and separates openings when wall space allows', () => {
    const walls = [{ x1: 0, y1: 0, x2: 500, y2: 0 }]
    const placed = placeOpeningsOnWalls([
      { x: 150, y: 0, width: 90 },
      { x: 150, y: 0, width: 90 },
    ], walls, 'cm')

    expect(placed.map((opening) => opening.width)).toEqual([90, 90])
    expect(Math.abs(placed[1].offset - placed[0].offset)).toBeGreaterThanOrEqual(90)
  })

  it('keeps every opening when all available wall space is already occupied', () => {
    const placed = placeOpeningsOnWalls([
      { x: 0.5, y: 0, width: 0.9 },
      { x: 0.5, y: 0, width: 0.9 },
    ], [{ x1: 0, y1: 0, x2: 1, y2: 0 }])

    expect(placed).toHaveLength(2)
    expect(placed.every((opening) => opening.width <= 1)).toBe(true)
  })

  it('uses unit-aware default opening widths when optional dimensions are omitted', () => {
    const doc = documentFromPlan({
      units: 'cm',
      walls: [{ x1: 0, y1: 0, x2: 500, y2: 0 }],
      doors: [{ x: 100, y: 0 }],
    })
    const door = Object.values(doc.nodes).find((node) => node.type === 'parametric' && node.kind === 'arch.door')

    expect(door?.type).toBe('parametric')
    if (!door || door.type !== 'parametric') throw new Error('Expected the transferred door to exist.')
    expect(door.props.width).toBe(900)
    expect(door.rotation).toBe(0)
  })

  it('places doors on the closest compatible derived wall in the 2D document', () => {
    const doc = documentFromPlan({
      title: 'Door placement',
      units: 'm',
      walls: [
        { x1: 0, y1: 0, x2: 6, y2: 0 },
        { x1: 6, y1: 0, x2: 6, y2: 4 },
        { x1: 6, y1: 4, x2: 0, y2: 4 },
        { x1: 0, y1: 4, x2: 0, y2: 0 },
        { x1: 3, y1: 0, x2: 3, y2: 4 },
      ],
      rooms: [
        { name: 'Room A', x: 0.06, y: 0.06, width: 2.88, height: 3.88 },
        { name: 'Room B', x: 3.06, y: 0.06, width: 2.88, height: 3.88 },
      ],
      doors: [{ x: 3.02, y: 2, width: 0.9, rotation: 90 }],
    })
    const door = Object.values(doc.nodes).find((node) => node.type === 'parametric' && node.kind === 'arch.door')

    expect(door?.type).toBe('parametric')
    if (!door || door.type !== 'parametric') throw new Error('Expected the transferred door to exist.')
    expect(door.x / 1000).toBeCloseTo(3)
    expect(door.y / 1000).toBeCloseTo(2)
    expect(door.rotation).toBeCloseTo(90)
  })
})
