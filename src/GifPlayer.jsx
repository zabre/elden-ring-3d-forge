/**
 * GifPlayer — décode le GIF frame par frame via omggif (CDN)
 * et applique un chroma-key automatique sur la 1ère couleur du coin
 * supérieur-gauche (couleur de fond détectée dynamiquement).
 * Résultat : fond transparent, rendu sur <canvas>.
 */
import { useEffect, useRef, useState } from 'react'

const BASE = import.meta.env.BASE_URL

function buildUrl(rawPath) {
  if (!rawPath) return ''
  return `${BASE.replace(/\/$/, '')}/${rawPath.replace(/^\//, '')}`
}

// Charge omggif depuis CDN (une seule fois)
let omggifPromise = null
function loadOmggif() {
  if (omggifPromise) return omggifPromise
  omggifPromise = new Promise((resolve, reject) => {
    if (window.GifReader) { resolve(window.GifReader); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js'
    s.onload = () => resolve(window.GifReader)
    s.onerror = reject
    document.head.appendChild(s)
  })
  return omggifPromise
}

// Distance colorimétrique simple entre deux pixels RGBA
function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2)
}

// Supprime la couleur de fond (coin haut-gauche) avec tolérance
function removeBackground(imageData, tolerance = 60) {
  const d = imageData.data
  // Couleur de référence = pixel [0,0]
  const refR = d[0], refG = d[1], refB = d[2]
  for (let i = 0; i < d.length; i += 4) {
    if (colorDist(d[i], d[i+1], d[i+2], refR, refG, refB) < tolerance) {
      d[i+3] = 0 // transparent
    }
  }
  return imageData
}

export default function GifPlayer({ animDef, state = 'idle', auraColor }) {
  const canvasRef  = useRef()
  const rafRef     = useRef()
  const framesRef  = useRef([])
  const frameIdxRef = useRef(0)
  const [error, setError] = useState(false)
  const [imgSrc, setImgSrc] = useState('') // fallback <img> si canvas échoue

  // URL courante selon l'état
  const rawPath = (state === 'attack' && animDef?.attack) ? animDef.attack : animDef?.idle
  const url = buildUrl(rawPath)

  useEffect(() => {
    if (!url) return
    setError(false)
    frameIdxRef.current = 0
    cancelAnimationFrame(rafRef.current)

    let cancelled = false

    async function decode() {
      let GifReader
      try {
        GifReader = await loadOmggif()
      } catch {
        // omggif indisponible → fallback <img>
        setImgSrc(`${url}?t=${Date.now()}`)
        return
      }

      let buf
      try {
        const res = await fetch(`${url}?t=${Date.now()}`)
        if (!res.ok) throw new Error('fetch failed')
        const ab = await res.arrayBuffer()
        buf = new Uint8Array(ab)
      } catch {
        setError(true)
        return
      }

      if (cancelled) return

      let reader
      try {
        reader = new GifReader(buf)
      } catch {
        setImgSrc(`${url}?t=${Date.now()}`)
        return
      }

      const w = reader.width
      const h = reader.height

      // Décode toutes les frames une fois
      const frames = []
      const offscreen = document.createElement('canvas')
      offscreen.width = w; offscreen.height = h
      const octx = offscreen.getContext('2d')

      for (let i = 0; i < reader.numFrames(); i++) {
        const info = reader.frameInfo(i)
        const pixels = new Uint8ClampedArray(w * h * 4)
        reader.decodeAndBlitFrameRGBA(i, pixels)
        const imgData = new ImageData(pixels, w, h)
        removeBackground(imgData)
        // Compose sur la frame précédente si disposal !== 2
        if (i > 0 && info.disposal !== 2) {
          const prev = frames[i - 1]
          octx.putImageData(prev.imgData, 0, 0)
          octx.putImageData(imgData, info.x || 0, info.y || 0)
          const composed = octx.getImageData(0, 0, w, h)
          frames.push({ imgData: composed, delay: Math.max((info.delay || 10) * 10, 20) })
        } else {
          frames.push({ imgData, delay: Math.max((info.delay || 10) * 10, 20) })
        }
      }

      if (cancelled || !frames.length) return
      framesRef.current = frames

      // Anime sur le canvas React
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')

      let lastTime = 0
      function tick(ts) {
        if (cancelled) return
        const frame = framesRef.current[frameIdxRef.current]
        if (!frame) return
        if (ts - lastTime >= frame.delay) {
          ctx.clearRect(0, 0, w, h)
          ctx.putImageData(frame.imgData, 0, 0)
          frameIdxRef.current = (frameIdxRef.current + 1) % framesRef.current.length
          lastTime = ts
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    decode()
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current) }
  }, [url])

  if (error) return null

  const filterStyle = [
    `drop-shadow(0 0 18px ${auraColor})`,
    `drop-shadow(0 0 6px ${auraColor})`,
    'drop-shadow(0 12px 24px rgba(0,0,0,0.95))',
  ].join(' ')

  // Fallback <img> si omggif n'a pas pu charger
  if (imgSrc) {
    return (
      <img
        key={imgSrc}
        src={imgSrc}
        alt=""
        className="gif-sprite"
        style={{ imageRendering: 'pixelated', filter: filterStyle }}
        draggable={false}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className="gif-sprite"
      style={{ imageRendering: 'pixelated', filter: filterStyle }}
      aria-hidden="true"
    />
  )
}
