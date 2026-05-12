// GifPlayer — charge un GIF idle ou attack depuis pixel-animations.json
// Les chemins dans le JSON sont RELATIFS (ex: "sprites/godfrey-animation.gif")
// BASE_URL est ajouté ici pour fonctionner en dev ET sur GitHub Pages.
import { useEffect, useRef, useState } from 'react'

export default function GifPlayer({ animDef, state = 'idle', auraColor }) {
  const [src, setSrc] = useState('')
  const prevState = useRef('')
  const BASE = import.meta.env.BASE_URL // ex: "/elden-ring-3d-forge/" ou "/"

  useEffect(() => {
    if (!animDef) return

    const rawPath = (state === 'attack' && animDef.attack)
      ? animDef.attack
      : animDef.idle

    if (!rawPath) return

    // Construit l'URL finale en évitant les doubles slashes
    const fullPath = `${BASE.replace(/\/$/, '')}/${rawPath.replace(/^\//, '')}`

    // Force le rechargement du GIF (repart frame 0) à chaque changement d'état
    if (prevState.current !== state) {
      setSrc(`${fullPath}?t=${Date.now()}`)
      prevState.current = state
    } else if (!src) {
      setSrc(fullPath)
    }
  }, [animDef, state])

  if (!src) return null

  return (
    <img
      key={src}
      src={src}
      alt=""
      className="gif-sprite"
      style={{
        imageRendering: 'pixelated',
        filter: [
          `drop-shadow(0 0 18px ${auraColor})`,
          `drop-shadow(0 0 6px ${auraColor})`,
          'drop-shadow(0 12px 24px rgba(0,0,0,0.95))',
        ].join(' '),
      }}
      draggable={false}
      onError={e => { e.currentTarget.style.display = 'none' }}
    />
  )
}
