import { applyOps, createDocument, leavesOf, roomAt, roomRegions, type Document, type Op } from '@opencalque/core'
import { deriveWallsFromRooms, placeOpeningsOnWalls, roomLayoutIssues } from './architectural-plan-geometry'
import { hideSplash } from './splash'
import { loadDocument, useStore } from './store'
import { useWindows } from './windows'

const CHANNEL = 'ai-taskflow:opencalque'

type PlanPoint = [number, number]
export type Plan = {
  title?: string
  units?: 'm' | 'cm'
  walls: Array<{ x1: number; y1: number; x2: number; y2: number; height?: number; thickness?: number }>
  rooms?: Array<{ name: string; x: number; y: number; width: number; height: number; polygon?: PlanPoint[] }>
  doors?: Array<{ x: number; y: number; width?: number; rotation?: number }>
  windows?: Array<{ x: number; y: number; width?: number; rotation?: number }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function planFromMessage(value: unknown): Plan {
  if (!isRecord(value) || !Array.isArray(value.walls)) throw new Error('The parent did not send a valid floor plan.')
  const units = value.units === 'cm' ? 'cm' : 'm'
  const walls = value.walls.map((item) => {
    if (!isRecord(item) || ![item.x1, item.y1, item.x2, item.y2].every((part) => typeof part === 'number' && Number.isFinite(part))) {
      throw new Error('The floor plan contains an invalid wall.')
    }
    return {
      x1: item.x1 as number, y1: item.y1 as number, x2: item.x2 as number, y2: item.y2 as number,
      height: number(item.height, 2.8), thickness: number(item.thickness, 0.18),
    }
  })
  const readRooms = (items: unknown): Plan['rooms'] => Array.isArray(items) ? items.map((item, index) => {
    if (!isRecord(item) || typeof item.name !== 'string' || ![item.x, item.y, item.width, item.height].every((part) => typeof part === 'number' && Number.isFinite(part)) || number(item.width) <= 0 || number(item.height) <= 0) {
      throw new Error(`Room ${index + 1} has invalid geometry.`)
    }
    const polygon = Array.isArray(item.polygon) ? item.polygon.filter((point): point is PlanPoint => Array.isArray(point) && point.length === 2 && point.every((part) => typeof part === 'number' && Number.isFinite(part))) : undefined
    return { name: item.name, x: item.x as number, y: item.y as number, width: item.width as number, height: item.height as number, ...(polygon && polygon.length >= 3 ? { polygon } : {}) }
  }) : []
  const readOpenings = (items: unknown, label: string): NonNullable<Plan['doors']> => Array.isArray(items) ? items.map((item, index) => {
    if (!isRecord(item) || ![item.x, item.y].every((part) => typeof part === 'number' && Number.isFinite(part)) ||
      item.width !== undefined && (typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width <= 0) ||
      item.rotation !== undefined && (typeof item.rotation !== 'number' || !Number.isFinite(item.rotation))) {
      throw new Error(`${label} ${index + 1} has invalid geometry.`)
    }
    return {
      x: item.x as number,
      y: item.y as number,
      ...(item.width === undefined ? {} : { width: item.width as number }),
      ...(item.rotation === undefined ? {} : { rotation: item.rotation as number }),
    }
  }) : []
  return {
    title: typeof value.title === 'string' ? value.title : 'Architectural plan',
    units, walls, rooms: readRooms(value.rooms), doors: readOpenings(value.doors, 'Door'), windows: readOpenings(value.windows, 'Window'),
  }
}

function millimetres(value: number, units: Plan['units']): number {
  return value * (units === 'cm' ? 10 : 1000)
}

export function documentFromPlan(plan: Plan): Document {
  if (plan.walls.length === 0) throw new Error('The floor plan needs at least one wall.')
  const roomIssues = roomLayoutIssues(plan.rooms ?? [])
  if (roomIssues.length > 0) throw new Error(roomIssues.join(' '))
  const walls = plan.rooms?.length
    ? deriveWallsFromRooms(plan.rooms, plan.walls, plan.units)
    : plan.walls
  const scale = plan.units === 'cm' ? 100 : 1
  const doors = plan.doors ?? []
  const windows = plan.windows ?? []
  const placedOpenings = placeOpeningsOnWalls([
    ...doors.map((opening) => ({ ...opening, width: opening.width ?? 0.9 * scale })),
    ...windows.map((opening) => ({ ...opening, width: opening.width ?? 1.5 * scale })),
  ], walls, plan.units)
  const placedDoors = placedOpenings.slice(0, doors.length)
  const placedWindows = placedOpenings.slice(doors.length)
  const ops: Op[] = [
    { op: 'update_node', id: 'page_1', patch: { name: plan.title || 'Ground floor' } },
    ...walls.map((wall, index): Op => ({
      op: 'add_node',
      node: {
        type: 'wall', id: `wall_${index + 1}`, parent: 'page_1', layer: 'layer_1',
        a: { x: millimetres(wall.x1, plan.units), y: millimetres(wall.y1, plan.units) },
        b: { x: millimetres(wall.x2, plan.units), y: millimetres(wall.y2, plan.units) },
        thickness: Math.max(1, millimetres(wall.thickness ?? 0.18, plan.units)),
        height: Math.max(1, millimetres(wall.height ?? 2.8, plan.units)),
      },
    })),
    ...(plan.rooms ?? []).map((room, index): Op => {
      const points = room.polygon?.map(([x, y]) => ({ x: millimetres(x, plan.units), y: millimetres(y, plan.units) }))
      const anchor = points?.length
        ? { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length }
        : { x: millimetres(room.x + room.width / 2, plan.units), y: millimetres(room.y + room.height / 2, plan.units) }
      return { op: 'add_node', node: { type: 'room', id: `room_${index + 1}`, parent: 'page_1', layer: 'layer_1', name: room.name, ...anchor } }
    }),
    ...placedDoors.map((place, index): Op => {
      return {
        op: 'add_node',
        node: {
          type: 'parametric', id: `door_${index + 1}`, parent: 'page_1', layer: 'layer_1',
          kind: 'arch.door',
          props: { width: millimetres(place.width, plan.units), height: 2040, type: 'Single', hinge: 'Left', angle: 90 },
          x: millimetres(place.x, plan.units), y: millimetres(place.y, plan.units), rotation: place.rotation,
        },
      }
    }),
    ...placedWindows.map((place, index): Op => {
      return {
        op: 'add_node',
        node: {
          type: 'parametric', id: `window_${index + 1}`, parent: 'page_1', layer: 'layer_1',
          kind: 'arch.window',           props: { width: millimetres(place.width, plan.units), height: 1250, panes: 2, glazing: 'Double', sill: 50 },
          x: millimetres(place.x, plan.units), y: millimetres(place.y, plan.units), rotation: place.rotation,
        },
      }
    }),
  ]
  return applyOps(createDocument(plan.title || 'Architectural plan'), ops)
}

export function planFromDocument(doc: Document): Plan {
  const page = Object.values(doc.nodes).find((node) => node.type === 'page')
  if (!page) throw new Error('The OpenCalque drawing has no page.')
  const nodes = leavesOf(doc, page.id)
  const walls = nodes.flatMap((node) => node.type === 'wall' ? [{
    x1: node.a.x / 1000, y1: node.a.y / 1000, x2: node.b.x / 1000, y2: node.b.y / 1000,
    height: (node.height ?? 2800) / 1000, thickness: node.thickness / 1000,
  }] : [])
  const markers = nodes.filter((node) => node.type === 'room')
  const assignedRegions = new Set(roomRegions(doc, page.id))
  const rooms: NonNullable<Plan['rooms']> = markers.flatMap((marker, index) => {
    const region = roomAt(doc, page.id, { x: marker.x, y: marker.y })
    if (!region || !assignedRegions.has(region)) return []
    assignedRegions.delete(region)
    const polygon = region.outline.map((point) => [point.x / 1000, point.y / 1000] as PlanPoint)
    const xs = polygon.map(([x]) => x)
    const ys = polygon.map(([, y]) => y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return {
      name: marker.name || `Room ${index + 1}`, x, y,
      width: Math.max(0.1, Math.max(...xs) - x), height: Math.max(0.1, Math.max(...ys) - y), polygon,
    }
  })
  const openings = nodes.flatMap((node) => node.type === 'parametric' && (node.kind === 'arch.door' || node.kind === 'arch.window') ? [{
    kind: node.kind, x: node.x / 1000, y: node.y / 1000,
    width: number(node.props.width, node.kind === 'arch.door' ? 900 : 1500) / 1000,
    rotation: node.rotation ?? 0,
  }] : [])
  return {
    title: doc.name, units: 'm', walls, rooms,
    doors: openings.filter((opening) => opening.kind === 'arch.door').map(({ x, y, width, rotation }) => ({ x, y, width, rotation })),
    windows: openings.filter((opening) => opening.kind === 'arch.window').map(({ x, y, width, rotation }) => ({ x, y, width, rotation })),
  }
}

export function startEmbeddedBridge(): void {
  const params = new URLSearchParams(location.search)
  const external = params.get('external') === '1' && window.opener !== null
  const embedded = params.get('embedded') === '1' && window.parent !== window
  if (!embedded && !external) return
  const parentOrigin = params.get('parentOrigin')
  if (!parentOrigin || new URL(parentOrigin).origin !== parentOrigin) throw new Error('The embedded editor needs a valid parent origin.')

  hideSplash()
  const peer = external ? window.opener : window.parent
  if (!peer) return
  const send = (type: string, payload?: unknown) => peer.postMessage({ channel: CHANNEL, type, payload }, parentOrigin)
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== peer || event.origin !== parentOrigin || !isRecord(event.data) || event.data.channel !== CHANNEL) return
    if (event.data.type === 'hello') {
      send('ready', { format: 'opencalque', version: 2 })
      return
    }
    if (event.data.type !== 'load-plan') return
    try {
      const plan = planFromMessage(event.data.payload)
      loadDocument(documentFromPlan(plan), null)
      useWindows.setState({ welcomeOpen: false })
      hideSplash()
    } catch (error) {
      send('error', { message: error instanceof Error ? error.message : 'OpenCalque could not load this floor plan.' })
    }
  })
  useStore.subscribe((state, previous) => {
    if (state.doc === previous.doc) return
    send('document', { document: state.doc, plan: planFromDocument(state.doc) })
  })
  if (external) send('ready', { format: 'opencalque', version: 2 })
}
