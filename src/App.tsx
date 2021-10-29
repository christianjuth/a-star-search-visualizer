// @ts-ignore
import generate from '@indutny/maze';
import { makeNoise2D } from 'fast-simplex-noise';
import Heap from 'heap';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { use100vh } from 'react-div-100vh';
import styled from 'styled-components';

const BLOCK_SIZE = 4;

function sleep(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

const Page = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

const FlexRow = styled.div`
  display: flex;
  flex-direction: row;
`

function useSignal() {
  const [signal, setSignal] = useState(0)

  const sendSignal = useCallback(
    () => {
      setSignal(s => (s + 1) % 1000)
    },
    []
  )

  return [signal, sendSignal] as const
}

function randomInt(min: number, max: number) {
  return Math.round(min + (Math.random() * (max - min)))
}

function coordsAreEqual(a: number[], b: number[]) {
  return a.join(',') === b.join(',') 
}

class Node {
  isDestination = false
  isStart = false
  isBlocked = false
  key = String(Math.random())
  manhattanDistance = 0
  x = 0
  y = 0
  gValue = 0
  isVisited = false
  highlighted = false
  newNode = true

  getKey() {
    let key = ""
    key += this.newNode ? 'N' : 'n'
    key += this.isVisited ? 'V' : 'v'
    key += this.highlighted ? 'H' : 'h'
    this.newNode = false
    return key
  }

  constructor({ isStart, isDestination, x, y, generator }: { isStart?: boolean, isDestination?: boolean, x: number, y: number, generator: (x: number, y: number) => boolean }) {
    this.x = x
    this.y = y
    if (isStart) {
      this.isStart = true
    } else if(isDestination) {
      this.isDestination = true
    } else {
      this.isBlocked = generator(x, y)
    }
  }

  getCoordinates() {
    return [this.x, this.y]
  }

  getId() {
    return this.getCoordinates().join(',')
  }

  getValue() {
    return this.manhattanDistance + this.gValue
  }

  reset() {
    this.isVisited = false
    this.highlighted = false
    this.gValue = 0
  }
}

class Map {
  data: InstanceType<typeof Node>[][] 
  start: number[]
  dest: number[]
  height: number
  width: number
  loading = true
  eventListeners: Record<string, (() => Promise<any> | any)[]> = {
    change: []
  }
  stop = false

  constructor(height = 50, width = 50, generatorType = 'perlin') {
    this.height = height
    this.width = width
    const dest = [randomInt(0, width*1/4), randomInt(0, height-1)]
    const start = [randomInt(width*3/4, width-1), randomInt(0, height-1)] 

    let generator: (x: number, y: number) => any = () => {}
    switch (generatorType) {
      case 'maze':
        const maze = generate({ width: this.width, height: this.height })
        generator = (x: number, y: number) => maze[y][x] === 1
        break;
      case 'perlin':
        const perlinGen = makeNoise2D()
        generator = (x: number, y: number) => perlinGen(x, y) > 0.5
        break;
      default: 
        generator = () => Math.random() < 1/3
    }
    this.start = start
    this.dest = dest
    this.data = Array(height).fill(0).map((_,y) => (
      Array(width).fill(0).map((_,x) => 
        new Node({
          isDestination: coordsAreEqual([x,y], dest),
          isStart: coordsAreEqual([x,y], start),
          x,
          y,
          generator,
        })
      ) 
    ))

    this.calcuateManhattanDistances()
    this.loading = false
    this.dispatchEvent('change')
  }

  getNeightbords([x, y]: number[]) {
    const neighbors = []
    if (x > 0) {
      // go left
      neighbors.push(this.data[y][x-1])
    }
    if (y > 0) {
      // go up
      neighbors.push(this.data[y-1][x])
    }
    if (x < this.width - 1) {
      // go right
      neighbors.push(this.data[y][x+1])
    }
    if (y < this.height - 1) {
      // go down
      neighbors.push(this.data[y+1][x])
    }
    return neighbors
  }

  getManhattanDistance(start: number[], dest: number[]) {
    return Math.abs(start[0] - dest[0]) + Math.abs(start[1] - dest[1])
  }

  calcuateManhattanDistances() {
    for (const row of this.data) {
      for (const node of row) {
        node.manhattanDistance = this.getManhattanDistance(node.getCoordinates(), this.dest)
      }
    }
  }

  async search(startCoords: number[], destCoords: number[], speed: number) {
    if (this.loading) {
      return
    }

    this.reset()

    // Prevent react updates while seraching
    this.loading = true
    this.dispatchEvent('change')

    const heap = new Heap((a: InstanceType<typeof Node>, b: InstanceType<typeof Node>) => {
      return a.getValue() - b.getValue()
    });
    const start = this.data[startCoords[1]][startCoords[0]]
    start.gValue = 0
    start.isVisited = true
    heap.push(start)
    let heapLength = 1
    let destNode: InstanceType<typeof Node> | null = null

    const prevNodes: Record<string, InstanceType<typeof Node> | null> = {
      [start.getId()]: null
    }
    const gValues: Record<string, number> = {
      [start.getId()]: 0
    }

    let i = 0
    while (heapLength > 0) {
      if (this.stop) {
        this.loading = false
        this.stop = false
        this.dispatchEvent('change')
        return
      }

      const crnt = heap.pop()
      heapLength -= 1

      if (coordsAreEqual(crnt.getCoordinates(), destCoords)) {
        destNode = crnt
        break
      }

      for (const neighbor of this.getNeightbords(crnt.getCoordinates())) {
        if (!neighbor.isBlocked && !neighbor.isVisited) {
          prevNodes[neighbor.getId()] = crnt
          neighbor.isVisited = true
          const neightborGValue = gValues[crnt.getId()] + 1
          gValues[neighbor.getId()] = neightborGValue
          neighbor.gValue = neightborGValue
          heap.push(neighbor)
          heapLength += 1
        }
      }

      if (speed > 0 && (i % (speed * 10) === 0)) {
        await sleep(1)
        this.dispatchEvent('change')
      }
      i++
    }

    if (destNode === null) {
      this.loading = false
      this.dispatchEvent('change') 
      return 'unrechable'
    }

    const path = []
    let crnt: typeof destNode | null = destNode
    
    while (crnt && prevNodes[crnt.getId()]) {
      if (this.stop) {
        this.loading = false
        this.stop = false
        this.dispatchEvent('change')
        return
      }

      crnt.highlighted = true
      crnt.isVisited = true
      if (speed > 0 && path.length % speed === 0) {
        await sleep(1)
        this.dispatchEvent('change')
      }
      path.push(crnt)
      crnt = prevNodes[crnt.getId()]
    }

    this.loading = false
    this.dispatchEvent('change')

    return path
  }

  forwardSearch(speed: number) {
    this.search(this.start, this.dest, speed)
  }

  backwardSearch(speed: number) {
    this.search(this.dest, this.start, speed)
  }

  dispatchEvent(type = 'change') {
    for (const fn of this.eventListeners[type]) {
      fn()
    }
  }

  addEventListener(type = 'change', fn: () => any) {
    this.eventListeners[type].push(fn)
  }

  removeEventListener(type = 'change', fn: () => any) {
    this.eventListeners[type] = this.eventListeners[type].filter(l => l !== fn)
  }  

  reset() {
    for (const node of this.data.flat()) {
      node.reset()
    }
  }

  stopSearch() {
    this.stop = true
  }
}

const dict: Record<string, string> = {}
function drawNode(ctx: CanvasRenderingContext2D, node: InstanceType<typeof Node>) {
  if (dict[node.getId()] === node.getKey()) {
    return
  }

  let backgroundColor = "black"
  if (node.highlighted) {
    backgroundColor = "red"
  } else if (node.isStart) {
    backgroundColor = "green"
  } else if (node.isDestination) {
    backgroundColor = "blue"
  } else if (node.isBlocked) {
    backgroundColor = "white"
  } else if(node.isVisited) {
    backgroundColor = 'green'
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(node.x * BLOCK_SIZE, node.y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

  dict[node.getId()] = node.getKey()
}

function CanvasGrid({
  map,
}: {
  map: InstanceType<typeof Node>[][]
}) {
  const height = (map.length) * BLOCK_SIZE
  const width = (map[0]?.length ?? 0) * BLOCK_SIZE
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (ctx) {
      for (const node of map.flat()) {
        drawNode(ctx!, node)
      }
    }
  })

  return (
    <canvas 
      ref={ref}
      height={height} 
      width={width}
    />
  )
}

function App() {
  const [,refresh] = useSignal()
  const [mapType, setMapType] = useState('random')
  const [speed, setSpeed] = useState(0)
  const pageHeight = use100vh() ?? 0
  const rows = Math.floor(pageHeight / BLOCK_SIZE)
  const cols = Math.floor((typeof window !== 'undefined' ? window.innerWidth : 0) / BLOCK_SIZE)

  const map = useMemo(
    () => new Map(
      Math.max(rows - 20, 0), 
      Math.max(cols - 20, 0), 
      mapType
    ),
    [mapType, rows, cols]
  )

  useEffect(() => {
    map.addEventListener('change', refresh)
    return () => map.removeEventListener('change', refresh)
  }, [map, refresh])

  return (
    <Page style={{minHeight: pageHeight}}>
      <CanvasGrid map={map.data} />

      <FlexRow style={{marginTop: 5}}>
        <button 
          onClick={() => map.forwardSearch(speed)}
          disabled={map.loading}
        >
          Forward search
        </button>

        <button 
          onClick={() => map.backwardSearch(speed)}
          disabled={map.loading}
        >
          Backward search
        </button>  

        <select value={mapType} onChange={e => setMapType(e.target.value)} disabled={map.loading}>
          {['random', 'perlin', 'maze'].map(option => (
            <option key={option} value={option}>Map type: {option}</option>
          ))}
        </select>

        <select onChange={e => setSpeed(parseInt(e.target.value))} disabled={map.loading}>
          {Array(20).fill(0).map((_,i) => (
            <option key={i} value={i}>
              Speed: {i}
            </option>
          ))}
        </select>

        <button 
          onClick={() => map.stopSearch()}
          disabled={!map.loading}
        >
          Stop search
        </button>  
      </FlexRow>
    </Page>
  );
}

export default App;
