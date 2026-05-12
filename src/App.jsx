import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

const LIBRARY_URL    = `${import.meta.env.BASE_URL}library.json`
const PIXEL_ANIM_URL = `${import.meta.env.BASE_URL}pixel-animations.json`
const AURA_COLORS = ['#ffffff', '#4a90d9', '#4caf7d', '#e0a030', '#e06020', '#c0392b']

const PIXEL_PALETTES = [
  { bg: '#1c1610', mid: '#2e2518', fg: '#c8b89a', accent: '#e8d5b0', shadow: '#0d0b08', hp: '#a8956e', name: 'VOYAGEUR' },
  { bg: '#0e1620', mid: '#1a2535', fg: '#8ab4d8', accent: '#b8d4f0', shadow: '#070d14', hp: '#5a8ab0', name: 'GARDIEN' },
  { bg: '#101a10', mid: '#1a2e1a', fg: '#8ab88a', accent: '#b0d8b0', shadow: '#080e08', hp: '#58985a', name: 'SENTINELLE' },
  { bg: '#1e1408', mid: '#302010', fg: '#d8a860', accent: '#f0c878', shadow: '#100a04', hp: '#c08030', name: 'CONQU\u00c9RANT' },
  { bg: '#1e0e08', mid: '#300e08', fg: '#d87850', accent: '#f09060', shadow: '#100604', hp: '#b85030', name: 'DESTRUCTEUR' },
  { bg: '#180810', mid: '#281018', fg: '#d05878', accent: '#e87898', shadow: '#0e0408', hp: '#a02848', name: 'D\u00c9VASTATEUR' },
]

function ensureInfo(model) {
  return { title: model?.name || '', difficulty: 3, ...model?.info }
}

function withCorsProxy(url) {
  if (!url) return url
  if (url.includes('drive.google.com')) return `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  return url
}

const MAX_CACHE = 8

function useModelCache(models, selectedId) {
  const cacheRef = useRef([])

  useEffect(() => {
    if (!models.length) return

    const selectedIdx = models.findIndex(m => m.id === selectedId)
    const selected = models[selectedIdx]

    const urlsToKeep = []
    if (selected?.url)    urlsToKeep.push(selected.url)
    if (selected?.altUrl) urlsToKeep.push(selected.altUrl)

    const adjacents = [
      models[selectedIdx - 1],
      models[selectedIdx + 1],
    ].filter(Boolean)

    adjacents.forEach(m => {
      if (m?.url)    { useGLTF.preload(m.url);    if (!urlsToKeep.includes(m.url))    urlsToKeep.push(m.url) }
      if (m?.altUrl) { useGLTF.preload(m.altUrl); if (!urlsToKeep.includes(m.altUrl)) urlsToKeep.push(m.altUrl) }
    })

    if (selected?.url    && !cacheRef.current.includes(selected.url))    cacheRef.current.push(selected.url)
    if (selected?.altUrl && !cacheRef.current.includes(selected.altUrl)) cacheRef.current.push(selected.altUrl)

    while (cacheRef.current.length > MAX_CACHE) {
      const oldest = cacheRef.current.shift()
      if (!urlsToKeep.includes(oldest)) {
        try { useGLTF.clear(oldest) } catch {}
      }
    }
  }, [models, selectedId])
}

class ViewerErrorBoundary extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidUpdate(prevProps) { if (prevProps.url !== this.props.url) this.setState({ hasError: false }) }
  render() { return this.state.hasError ? null : this.props.children }
}

function AshParticles({ color = '#c9a84c', count = 50 }) {
  const meshRef = useRef()
  const data = useMemo(() => {
    const arr = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 10
      arr[i * 3 + 1] = Math.random() * 8
      arr[i * 3 + 2] = (Math.random() - 0.5) * 10
      speeds[i] = 0.002 + Math.random() * 0.005
    }
    return { pos: arr, speeds }
  }, [count])

  useFrame(() => {
    if (!meshRef.current) return
    const pos = meshRef.current.geometry.attributes.position
    for (let i = 0; i < count; i++) {
      pos.array[i * 3 + 1] += data.speeds[i]
      if (pos.array[i * 3 + 1] > 8) pos.array[i * 3 + 1] = 0
      pos.array[i * 3] += Math.sin(Date.now() * 0.0003 + i) * 0.002
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={meshRef}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[data.pos, 3]} /></bufferGeometry>
      <pointsMaterial size={0.03} color={color} transparent opacity={0.6} sizeAttenuation />
    </points>
  )
}

function AuraLight({ difficulty, position }) {
  const color = new THREE.Color(AURA_COLORS[difficulty] || AURA_COLORS[3])
  return <pointLight position={position} intensity={2} distance={5} color={color} />
}

function EldenModel({ url, position = [0, 0, 0] }) {
  const gltf = useGLTF(url)
  const groupRef = useRef()
  const [spawnTime, setSpawnTime] = useState(Date.now())

  useEffect(() => setSpawnTime(Date.now()), [url])

  const { object, scale } = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true; node.receiveShadow = true
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material]
          mats.forEach(m => { m.side = THREE.DoubleSide; m.envMapIntensity = 1.2; m.needsUpdate = true })
        }
      }
    })
    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z) || 1
    root.position.sub(center)
    return { object: root, scale: 3.5 / longest }
  }, [gltf.scene])

  useFrame(() => {
    if (!groupRef.current) return
    const t = Math.min((Date.now() - spawnTime) / 500, 1)
    const ease = 1 - Math.pow(1 - t, 3)
    groupRef.current.position.y = position[1] - 1 + ease
    groupRef.current.scale.setScalar(scale * (0.8 + ease * 0.2))
  })

  return <group ref={groupRef} position={position}><primitive object={object} /></group>
}

function Scene({ selected, altActive, autoRotate, orbitRef, glRef }) {
  const { gl } = useThree()
  useEffect(() => { if (glRef) glRef.current = gl }, [gl, glRef])

  const url = altActive && selected?.altUrl ? selected.altUrl : selected?.url
  const diff = ensureInfo(selected).difficulty || 3

  return (
    <>
      <color attach="background" args={['#050608']} />
      <fogExp2 attach="fog" color="#050608" density={0.06} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 4]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 3, -3]} intensity={1.5} color="#8fb5ff" />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]}>
        <circleGeometry args={[8, 64]} />
        <meshStandardMaterial color="#0a0a10" roughness={0.8} metalness={0.4} />
      </mesh>
      <Suspense fallback={null}>
        <Environment preset="night" />
        {url && (
          <ViewerErrorBoundary url={url}>
            <EldenModel url={url} position={[0, 0, 0]} />
            <AuraLight difficulty={diff} position={[0, -1, 0]} />
            <AshParticles color={AURA_COLORS[diff]} />
          </ViewerErrorBoundary>
        )}
      </Suspense>
      <OrbitControls ref={orbitRef} enableDamping dampingFactor={0.05} minDistance={3} maxDistance={12} target={[0, 1, 0]} autoRotate={autoRotate} autoRotateSpeed={0.5} />
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.5} intensity={0.8} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.8} />
        <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.001, 0.001]} />
      </EffectComposer>
    </>
  )
}

function PixelDust({ palette }) {
  const canvasRef = useRef()
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width = canvas.offsetWidth
    const H = canvas.height = canvas.offsetHeight
    const colors = [palette.accent, palette.fg, palette.hp, '#ffffff']
    const particles = Array.from({ length: 36 }, () => ({
      x: Math.random() * W,
      y: H * 0.4 + Math.random() * H * 0.5,
      size: (Math.floor(Math.random() * 2) + 1) * 2,
      speed: 0.25 + Math.random() * 0.55,
      drift: (Math.random() - 0.5) * 0.4,
      life: Math.random(),
      maxLife: 0.5 + Math.random() * 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    let raf
    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      particles.forEach(p => {
        p.y -= p.speed
        p.x += p.drift + Math.sin(p.y * 0.02) * 0.25
        p.life += 0.007
        if (p.life >= p.maxLife || p.y < 0) {
          p.x = Math.random() * W
          p.y = H
          p.life = 0
          p.color = colors[Math.floor(Math.random() * colors.length)]
          p.size = (Math.floor(Math.random() * 2) + 1) * 2
        }
        ctx.globalAlpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.75
        ctx.fillStyle = p.color
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size)
      })
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [palette])
  return <canvas ref={canvasRef} className="pixel-dust" aria-hidden="true" />
}

function JRPGHPBar({ difficulty, palette }) {
  const maxHP = 240
  const hp = Math.round(maxHP * Math.max(0.08, 1 - (difficulty - 1) / 5.5))
  const [animHP, setAnimHP] = useState(maxHP)

  useEffect(() => {
    setAnimHP(maxHP)
    let frame, start = null
    const step = (ts) => {
      if (!start) start = ts
      const t = Math.min((ts - start) / 1100, 1)
      setAnimHP(Math.round(maxHP - (maxHP - hp) * (1 - Math.pow(1 - t, 2))))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [hp])

  const pct = animHP / maxHP
  const barW = Math.round(pct * 100)
  const hpColor = pct > 0.5 ? palette.hp : pct > 0.25 ? '#c8882a' : '#c83030'

  return (
    <div className="jrpg-hpbar-wrap">
      <div className="jrpg-hpbar-labels">
        <span className="jrpg-hpbar-name">HP</span>
        <span className="jrpg-hpbar-nums" style={{ color: palette.accent }}>{animHP}<span className="jrpg-hpbar-max">/{maxHP}</span></span>
      </div>
      <div className="jrpg-hpbar-track">
        <div className="jrpg-hpbar-fill" style={{ width: `${barW}%`, background: hpColor, boxShadow: `0 0 6px ${hpColor}` }} />
        <div className="jrpg-hpbar-shine" />
      </div>
    </div>
  )
}

function JRPGMPBar({ difficulty, palette }) {
  const maxMP = 120
  const mp = Math.round(maxMP * (0.3 + (difficulty / 5) * 0.65))
  const pct = mp / maxMP
  return (
    <div className="jrpg-mpbar-wrap">
      <div className="jrpg-hpbar-labels">
        <span className="jrpg-hpbar-name" style={{ color: '#88aadd' }}>MP</span>
        <span className="jrpg-hpbar-nums" style={{ color: '#aaccff' }}>{mp}<span className="jrpg-hpbar-max">/{maxMP}</span></span>
      </div>
      <div className="jrpg-mpbar-track">
        <div className="jrpg-mpbar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
        <div className="jrpg-hpbar-shine" />
      </div>
    </div>
  )
}

function JRPGHearts({ difficulty }) {
  const total = 3
  const full = Math.max(0, total - Math.floor((difficulty - 1) / 2))
  return (
    <div className="jrpg-hearts">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`jrpg-heart ${i < full ? 'full' : 'empty'}`}>♥</span>
      ))}
    </div>
  )
}

function GifPlayer({ animDef, state = 'idle', auraColor }) {
  const [src, setSrc] = useState('')
  const prevState = useRef('')

  useEffect(() => {
    if (!animDef) return
    const target = (state === 'attack' && animDef.attack)
      ? animDef.attack
      : animDef.idle

    if (prevState.current !== state) {
      setSrc(`${target}?t=${Date.now()}`)
      prevState.current = state
    } else if (!src) {
      setSrc(target)
    }
  }, [animDef, state])

  if (!animDef || !src) return null

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
    />
  )
}

function RetroViewer({ selected, altActive, pixelAnimations }) {
  const info      = ensureInfo(selected)
  const diff      = Math.max(0, Math.min(5, info.difficulty || 3))
  const palette   = PIXEL_PALETTES[diff]
  const auraColor = AURA_COLORS[diff]

  const animDef   = selected?.id ? pixelAnimations[selected.id] : null
  const animState = altActive ? 'attack' : 'idle'

  const spriteUrl = altActive
    ? (selected?.spriteAttack || selected?.spriteIdle || '')
    : (selected?.spriteIdle || '')
  const bgUrl    = selected?.pixelArenaBackground || ''
  const bossName = (selected?.name || '???').toUpperCase()

  return (
    <div
      className="retro-viewer"
      style={{
        '--aura':       auraColor,
        '--pal-bg':     palette.bg,
        '--pal-mid':    palette.mid,
        '--pal-fg':     palette.fg,
        '--pal-accent': palette.accent,
        '--pal-shadow': palette.shadow,
        '--pal-hp':     palette.hp,
      }}
    >
      <div className="retro-sky"    aria-hidden="true" />
      <div className="retro-clouds" aria-hidden="true" />

      {bgUrl
        ? <div className="retro-arena-bg" style={{ backgroundImage: `url(${bgUrl})` }} />
        : <div className="retro-arena-bg retro-arena-placeholder" />
      }

      <div className="retro-floor" aria-hidden="true">
        <div className="retro-floor-circle" />
      </div>

      <div className="retro-ground-shadow" aria-hidden="true" />

      <div className="retro-sprite-wrap" key={`${selected?.id}-${animState}`}>
        {animDef
          ? <GifPlayer animDef={animDef} state={animState} auraColor={auraColor} />
          : spriteUrl
            ? <img className="retro-sprite" src={spriteUrl} alt={selected?.name || 'Boss'} />
            : <RetroPlaceholderSprite name={selected?.name} color={auraColor} palette={palette} altActive={altActive} />
        }
      </div>

      <div className="jrpg-hud-topleft">
        <JRPGHearts difficulty={diff} />
        <div className="jrpg-hud-mana-row">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="jrpg-mana-pip" style={{ background: i < diff ? '#6699ff' : 'rgba(255,255,255,0.1)' }} />
          ))}
        </div>
      </div>

      <div className="jrpg-boss-hud">
        <div className="jrpg-boss-hud-inner">
          <div className="jrpg-boss-header">
            <span className="jrpg-boss-rank" style={{ color: palette.accent }}>✦ {palette.name} ✦</span>
          </div>
          <div className="jrpg-boss-name" style={{ color: palette.fg }}>{bossName}</div>
          <JRPGHPBar difficulty={diff} palette={palette} />
          <JRPGMPBar difficulty={diff} palette={palette} />
          <div className="jrpg-boss-footer">
            <div className="jrpg-stars">
              {[1,2,3,4,5].map(v => (
                <span key={v} style={{ color: v <= diff ? palette.accent : 'rgba(255,255,255,0.15)', filter: v <= diff ? `drop-shadow(0 0 3px ${palette.accent})` : 'none' }}>★</span>
              ))}
            </div>
            {animDef && (
              <span className="jrpg-anim-badge" style={{ borderColor: palette.accent, color: palette.accent }}>🎞 GIF</span>
            )}
            {altActive && (
              <span className="jrpg-phase-badge" style={{ borderColor: palette.accent, color: palette.accent }}>⚔ PHASE 2</span>
            )}
          </div>
        </div>
      </div>

      <PixelDust palette={palette} />

      <div className="retro-corner retro-corner-tl" style={{ '--c': palette.accent }} aria-hidden="true" />
      <div className="retro-corner retro-corner-tr" style={{ '--c': palette.accent }} aria-hidden="true" />
      <div className="retro-corner retro-corner-bl" style={{ '--c': palette.accent }} aria-hidden="true" />
      <div className="retro-corner retro-corner-br" style={{ '--c': palette.accent }} aria-hidden="true" />
      <div className="retro-scanlines" aria-hidden="true" />
      <div className="retro-vignette"  aria-hidden="true" />
    </div>
  )
}

function RetroPlaceholderSprite({ name, color, palette, altActive }) {
  return (
    <div className="retro-placeholder-sprite" style={{ '--aura': color }}>
      <svg viewBox="0 0 72 96" xmlns="http://www.w3.org/2000/svg"
        className={`retro-svg-boss${altActive ? ' retro-svg-attack' : ''}`}>
        <rect x="14" y="40" width="44" height="48" rx="2" fill={palette.shadow} opacity="0.6" />
        <rect x="18" y="38" width="36" height="46" rx="2" fill={color} opacity="0.7" />
        <rect x="22" y="24" width="28" height="26" fill={color} />
        <rect x="24" y="26" width="24" height="22" fill={palette.mid} />
        <rect x="26" y="28" width="20" height="2" fill={palette.accent} opacity="0.6" />
        <rect x="26" y="32" width="20" height="2" fill={palette.accent} opacity="0.4" />
        <rect x="26" y="36" width="20" height="2" fill={palette.accent} opacity="0.25" />
        <rect x="12" y="22" width="12" height="10" rx="1" fill={color} />
        <rect x="48" y="22" width="12" height="10" rx="1" fill={color} />
        <rect x="13" y="23" width="10" height="3" fill={palette.accent} opacity="0.5" />
        <rect x="49" y="23" width="10" height="3" fill={palette.accent} opacity="0.5" />
        <rect x="26" y="6" width="20" height="18" fill={color} />
        <rect x="28" y="8" width="16" height="14" fill={palette.mid} />
        <rect x="28" y="14" width="16" height="6" fill={palette.shadow} />
        <rect x="30" y="15" width="5" height="3" fill={palette.accent} opacity="0.9" />
        <rect x="37" y="15" width="5" height="3" fill={palette.accent} opacity="0.9" />
        <rect x="32" y="2" width="8" height="6" fill={palette.accent} opacity="0.8" />
        <rect x="34" y="0" width="4" height="4" fill={palette.fg} opacity="0.6" />
        <rect x="8" y="26" width="10" height="20" rx="1" fill={color} opacity="0.9" />
        <rect x="56" y="4" width="6" height="52" rx="1" fill="#b8c8d8" />
        <rect x="50" y="28" width="18" height="5" rx="1" fill="#c8b870" />
        <rect x="57" y="5" width="2" height="50" fill="#e8f0ff" opacity="0.5" />
        <rect x="56" y="2" width="6" height="4" fill={palette.accent} opacity="0.8" />
        <rect x="22" y="62" width="13" height="26" fill={color} opacity="0.85" />
        <rect x="37" y="62" width="13" height="26" fill={color} opacity="0.85" />
        <rect x="22" y="84" width="13" height="4" fill={palette.shadow} />
        <rect x="37" y="84" width="13" height="4" fill={palette.shadow} />
        {altActive && (
          <>
            <rect x="54" y="20" width="18" height="4" fill="#ffffff" opacity="0.85" transform="rotate(-20 54 20)" />
            <rect x="56" y="30" width="14" height="3" fill="#ffffff" opacity="0.55" transform="rotate(-20 56 30)" />
            <rect x="58" y="38" width="10" height="2" fill="#ffffff" opacity="0.3"  transform="rotate(-20 58 38)" />
          </>
        )}
      </svg>
    </div>
  )
}

function Typewriter({ text, speed = 25 }) {
  const [displayed, setDisplayed] = useState('')
  useEffect(() => {
    setDisplayed('')
    if (!text) return
    let i = 0
    const id = setInterval(() => {
      setDisplayed(text.slice(0, ++i))
      if (i >= text.length) clearInterval(id)
    }, speed)
    return () => clearInterval(id)
  }, [text, speed])
  return <span>{displayed}<span className="retro-cursor">▌</span></span>
}

function CardsZones({ info, isPixelMode }) {
  return (
    <div className="bottom-panels">
      <div className="bp-card bp-large">
        <div className="bp-header">
          <span className="bp-icon">⌖</span>
          <span className="bp-title">Arène &amp; Environnement</span>
        </div>
        <div className="bp-content">
          <div className={`bp-media-slot${isPixelMode ? ' pixel-img' : ''}`}
            style={{ backgroundImage: info.arenaImage ? `url(${info.arenaImage})` : 'none' }}>
            {!info.arenaImage && <span className="bp-media-placeholder">Média Arène</span>}
          </div>
          <div className="bp-text">
            {isPixelMode
              ? <Typewriter text={info.arena || info.area || "Informations sur l'arène indisponibles."} />
              : (info.arena || info.area || "Informations sur l'arène indisponibles.")
            }
          </div>
        </div>
      </div>
      <div className="bp-card bp-large">
        <div className="bp-header">
          <span className="bp-icon">⚔</span>
          <span className="bp-title">Arsenal &amp; Mouvements</span>
        </div>
        <div className="bp-content">
          <div className={`bp-media-slot${isPixelMode ? ' pixel-img' : ''}`}
            style={{ backgroundImage: info.weaponImage ? `url(${info.weaponImage})` : 'none' }}>
            {!info.weaponImage && <span className="bp-media-placeholder">Média Arme</span>}
          </div>
          <div className="bp-text">
            {isPixelMode
              ? <Typewriter text={info.weapon || info.keyMoves || "Informations sur l'arme indisponibles."} speed={20} />
              : (info.weapon || info.keyMoves || "Informations sur l'arme indisponibles.")
            }
          </div>
        </div>
      </div>
      <div className="bp-card bp-small">
        <div className="bp-header">
          <span className="bp-icon">◈</span>
          <span className="bp-title">Butin</span>
        </div>
        <div className="bp-content">
          <div className="bp-text">
            {isPixelMode
              ? <Typewriter text={info.drops || "Aucun butin répertorié."} speed={30} />
              : (info.drops || "Aucun butin répertorié.")
            }
          </div>
        </div>
      </div>
    </div>
  )
}

function GlitchTransition({ active }) {
  if (!active) return null
  return <div className="glitch-overlay" aria-hidden="true" />
}

function PixelToggleButton({ isPixelMode, onClick }) {
  return (
    <button
      className={`pixel-toggle-btn${isPixelMode ? ' active' : ''}`}
      onClick={onClick}
      title={isPixelMode ? 'Mode 3D Next-Gen' : 'Mode 16-bit Pixel'}
      aria-label={isPixelMode ? 'Passer en mode 3D' : 'Passer en mode Pixel Art'}
    >
      <span className="ptb-icon">{isPixelMode ? '🎮' : '⬛'}</span>
      <span className="ptb-label">{isPixelMode ? '3D' : 'PIXEL'}</span>
    </button>
  )
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [models, setModels]                   = useState([])
  const [pixelAnimations, setPixelAnimations] = useState({})
  const [selectedId, setSelectedId]           = useState(new URLSearchParams(window.location.search).get('boss') || 'margit')
  const [search, setSearch]                   = useState('')
  const [filterDiff, setFilterDiff]           = useState(0)
  const [autoRotate, setAutoRotate]           = useState(true)
  const [altActive, setAltActive]             = useState(false)
  const [showTip, setShowTip]                 = useState(true)
  const [isPixelMode, setIsPixelMode]         = useState(false)
  const [glitching, setGlitching]             = useState(false)
  const [sidebarOpen, setSidebarOpen]         = useState(false)

  const orbitRef = useRef(); const glRef = useRef()
  const selectedModel = models.find(m => m.id === selectedId) || models[0]

  useModelCache(models, selectedId)

  useEffect(() => {
    if (isPixelMode) document.body.classList.add('theme-pixel')
    else document.body.classList.remove('theme-pixel')
    return () => document.body.classList.remove('theme-pixel')
  }, [isPixelMode])

  const handlePixelToggle = useCallback(() => {
    setGlitching(true)
    setTimeout(() => { setIsPixelMode(v => !v); setGlitching(false) }, 480)
  }, [])

  // Sélectionne un boss ET ferme la sidebar sur mobile
  const handleSelectBoss = useCallback((id) => {
    setSelectedId(id)
    setSidebarOpen(false)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch(LIBRARY_URL).then(r => r.json()),
      fetch(PIXEL_ANIM_URL).then(r => r.json()).catch(() => ({})),
    ]).then(([libraryData, animData]) => {
      const parsed = libraryData.map((m, i) => ({
        ...m,
        id:     m.id || `boss-${i}`,
        url:    withCorsProxy(m.remoteUrl)  || (m.modelPath  ? `${import.meta.env.BASE_URL}${m.modelPath}`  : ''),
        altUrl: withCorsProxy(m.remoteUrl2) || (m.modelPath2 ? `${import.meta.env.BASE_URL}${m.modelPath2}` : ''),
      }))
      setModels(parsed)
      setPixelAnimations(
        Object.fromEntries(Object.entries(animData).filter(([k]) => !k.startsWith('_')))
      )
    })
  }, [])

  useEffect(() => {
    if (selectedId) {
      const url = new URL(window.location)
      url.searchParams.set('boss', selectedId)
      window.history.pushState({}, '', url)
      setAltActive(false)
      setShowTip(true)
      setTimeout(() => setShowTip(false), 3000)
    }
  }, [selectedId])

  const filteredModels = useMemo(() => {
    let res = models
    if (filterDiff > 0) res = res.filter(m => ensureInfo(m).difficulty === filterDiff)
    if (search) res = res.filter(m => (m.name + ensureInfo(m).tags).toLowerCase().includes(search.toLowerCase()))
    return res
  }, [models, search, filterDiff])

  return (
    <div className="app-shell">
      <GlitchTransition active={glitching} />

      <header className="app-header">
        <div className="app-header-brand">
          <svg className="brand-icon" viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" stroke="currentColor" fill="none" /></svg>
          <div>
            <h1>Elden Ring 3D Forge</h1>
            <p>Codex interactif des Terres Intermédiaires</p>
          </div>
        </div>

        {/* Bouton hamburger — dans le header, toujours visible sur mobile */}
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen(v => !v)}
          aria-label="Ouvrir la liste des boss"
          aria-expanded={sidebarOpen}
        >
          <span className="mobile-menu-btn-icon">{sidebarOpen ? '✕' : '☰'}</span>
          <span className="mobile-menu-btn-label">Boss</span>
        </button>

        <div className="app-header-actions">
          <PixelToggleButton isPixelMode={isPixelMode} onClick={handlePixelToggle} />
          <span className="boss-count">{models.length} boss</span>
        </div>
      </header>

      <div className="app-body">
        {/* Backdrop pour fermer la sidebar en cliquant à côté */}
        {sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-search">
            <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="sidebar-filters">
            <details>
              <summary>Filtres &amp; Tags</summary>
              <div className="filter-options">
                {[0,1,2,3,4,5].map(d => (
                  <button key={d} className={`filter-btn ${filterDiff===d?'active':''}`} onClick={() => setFilterDiff(d)}>{d === 0 ? 'Tous' : `${d}★`}</button>
                ))}
              </div>
            </details>
          </div>
          <ul className="model-list">
            {filteredModels.map(m => {
              const diff = ensureInfo(m).difficulty || 0
              return (
                <li key={m.id}>
                  <button className={`model-item ${selectedId === m.id ? 'active' : ''}`} onClick={() => handleSelectBoss(m.id)}>
                    <div className="model-item-top">
                      <span className="model-diff-dot" style={{ background: AURA_COLORS[diff] }} />
                      <span className="model-name">{m.name}</span>
                      {m.altUrl && <span className="model-alt-dot">②</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <main className="main-pane" onPointerDown={() => setShowTip(false)}>
          <div className="viewer-wrapper">
            {!isPixelMode && (
              <>
                <Canvas
                  className="viewer-canvas"
                  camera={{ position: [0, 1.5, 6], fov: 45 }}
                  gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, preserveDrawingBuffer: true }}
                >
                  <Scene selected={selectedModel} altActive={altActive} autoRotate={autoRotate} orbitRef={orbitRef} glRef={glRef} />
                </Canvas>
                {showTip && <div className="viewer-tip">Drag to rotate · Scroll to zoom · Ctrl+drag to pan</div>}
                {selectedModel?.altUrl && (
                  <div className="phase-switcher">
                    <button className={`ps-btn ${!altActive?'active':''}`} onClick={() => setAltActive(false)}>Phase 1</button>
                    <button className={`ps-btn ${altActive?'active':''}`}  onClick={() => setAltActive(true)}>Phase 2</button>
                  </div>
                )}
                {!selectedModel?.url && (
                  <div className="viewer-error">
                    <div className="viewer-error-icon">⚠</div>
                    <p>Le modèle a sombré dans les Terres Intermédiaires</p>
                  </div>
                )}
                <div className="viewer-controls-bar">
                  <button className={`vc-btn ${autoRotate?'active':''}`} onClick={() => setAutoRotate(!autoRotate)}>⟲ Rotate</button>
                  <button className="vc-btn" onClick={() => orbitRef.current?.reset()}>◉ Reset</button>
                </div>
              </>
            )}

            {isPixelMode && (
              <>
                <RetroViewer selected={selectedModel} altActive={altActive} pixelAnimations={pixelAnimations} />
                {selectedModel?.altUrl && (
                  <div className="phase-switcher">
                    <button className={`ps-btn ${!altActive?'active':''}`} onClick={() => setAltActive(false)}>Phase 1</button>
                    <button className={`ps-btn ${altActive?'active':''}`}  onClick={() => setAltActive(true)}>Attaque !</button>
                  </div>
                )}
              </>
            )}
          </div>

          {selectedModel && <CardsZones info={ensureInfo(selectedModel)} isPixelMode={isPixelMode} />}
        </main>

        <aside className="info-pane">
          {selectedModel && (
            <>
              <div className="info-header">
                <h2 className="info-boss-name">
                  {isPixelMode
                    ? <Typewriter text={ensureInfo(selectedModel).title} speed={40} />
                    : ensureInfo(selectedModel).title
                  }
                </h2>
                <div className="diff-stars">
                  {[1,2,3,4,5].map(v => <span key={v} className={`star ${v <= ensureInfo(selectedModel).difficulty ? 'active':''}`}>★</span>)}
                </div>
              </div>
              <details className="info-accordion" open>
                <summary>Style de combat</summary>
                <div className="info-accordion-body">
                  <div className="info-field-label">Patterns</div>
                  <div className="info-field-value">
                    {isPixelMode
                      ? <Typewriter text={ensureInfo(selectedModel).keyMoves} speed={15} />
                      : ensureInfo(selectedModel).keyMoves
                    }
                  </div>
                  <div className="info-field-label" style={{marginTop:'0.5rem'}}>Stratégie</div>
                  <div className="info-field-value">
                    {isPixelMode
                      ? <Typewriter text={ensureInfo(selectedModel).strategyNotes} speed={15} />
                      : ensureInfo(selectedModel).strategyNotes
                    }
                  </div>
                </div>
              </details>
              <details className="info-accordion" open>
                <summary>Lore</summary>
                <div className="info-accordion-body">
                  <div className="info-field-value" style={{ fontStyle:'italic', color:'var(--text-muted)' }}>
                    {isPixelMode
                      ? <Typewriter text={ensureInfo(selectedModel).lore || 'Aucune archive trouvée.'} speed={20} />
                      : (ensureInfo(selectedModel).lore || 'Aucune archive trouvée.')
                    }
                  </div>
                </div>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
