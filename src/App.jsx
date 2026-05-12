import React, {
  Component, Suspense, useCallback, useEffect,
  useMemo, useRef, useState
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF, Html } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY    = 'er3d-library-v1'
const SELECTED_KEY   = 'er3d-selected-v1'
const DEFAULT_SELECTED = 'hoarah-loux'
const LIBRARY_URL    = `${import.meta.env.BASE_URL}library.json`

// Aura colors by difficulty
const AURA_COLORS = [
  '#ffffff',   // 0 — none
  '#4a90d9',   // 1 — blue
  '#4caf7d',   // 2 — green
  '#e0a030',   // 3 — amber
  '#e06020',   // 4 — orange
  '#c0392b',   // 5 — scarlet
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isBlobUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:')
}

function isBuiltinPath(url) {
  if (!url || typeof url !== 'string') return false
  return url.includes('/models/') && !url.startsWith('http') && !url.startsWith('blob:')
}

function withCorsProxy(url) {
  if (!url || typeof url !== 'string') return url
  if (
    url.includes('drive.google.com') ||
    url.includes('dropbox.com') ||
    url.includes('1drv.ms') ||
    url.includes('onedrive.live.com')
  ) return `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  return url
}

function loadStoredModels() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((model) => {
      if (isBlobUrl(model.url) || isBuiltinPath(model.url)) return { ...model, url: '' }
      if (model.url) return { ...model, url: withCorsProxy(model.url) }
      return model
    })
  } catch { return [] }
}

function loadStoredSelected() {
  if (typeof window === 'undefined') return DEFAULT_SELECTED
  try {
    const v = window.localStorage.getItem(SELECTED_KEY)
    return v || DEFAULT_SELECTED
  } catch { return DEFAULT_SELECTED }
}

const DEFAULT_INFO = {
  title: '', role: '', area: '', affiliation: '',
  difficulty: 3, recommendedLevel: '',
  fightStyle: '', keyMoves: '', strategyNotes: '', tags: '',
  lore: '', drops: '', arena: '', weapon: '',
  annotations: [],
}

function ensureInfo(model) {
  if (!model) return DEFAULT_INFO
  return { ...DEFAULT_INFO, ...(model.info || {}) }
}

// ─── URL sharing ──────────────────────────────────────────────────────────────
function getBossFromUrl() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('boss')
}

function setBossInUrl(id) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('boss', id)
  window.history.pushState({}, '', url)
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ViewerErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, message: '' } }
  static getDerivedStateFromError(error) { return { hasError: true, message: error?.message || 'Erreur inconnue' } }
  componentDidCatch(error, info) { console.warn('[Viewer]', error, info) }
  render() {
    if (this.state.hasError) return (
      <div className="viewer-error">
        <div className="viewer-error-icon">⚠</div>
        <p>Le modèle a sombré dans les Terres Intermédiaires</p>
        <span className="viewer-error-detail">{this.state.message}</span>
        <button type="button" onClick={() => this.setState({ hasError: false, message: '' })}>Réessayer</button>
      </div>
    )
    return this.props.children
  }
}

// ─── Particles (cendres flottantes) ───────────────────────────────────────────
function AshParticles({ color = '#c9a84c', count = 60 }) {
  const meshRef = useRef()
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 8
      arr[i * 3 + 1] = Math.random() * 6
      arr[i * 3 + 2] = (Math.random() - 0.5) * 8
    }
    return arr
  }, [count])

  const speeds = useMemo(() => {
    return Array.from({ length: count }, () => 0.002 + Math.random() * 0.006)
  }, [count])

  useFrame(() => {
    if (!meshRef.current) return
    const pos = meshRef.current.geometry.attributes.position
    for (let i = 0; i < count; i++) {
      pos.array[i * 3 + 1] += speeds[i]
      if (pos.array[i * 3 + 1] > 6) pos.array[i * 3 + 1] = 0
      pos.array[i * 3] += Math.sin(Date.now() * 0.0003 + i) * 0.002
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.025} color={color} transparent opacity={0.4} sizeAttenuation />
    </points>
  )
}

// ─── Aura light ───────────────────────────────────────────────────────────────
function AuraLight({ difficulty }) {
  const lightRef = useRef()
  const targetColor = useMemo(() => new THREE.Color(AURA_COLORS[difficulty] || AURA_COLORS[3]), [difficulty])
  const currentColor = useRef(new THREE.Color(AURA_COLORS[difficulty] || AURA_COLORS[3]))

  useFrame(() => {
    if (!lightRef.current) return
    currentColor.current.lerp(targetColor, 0.04)
    lightRef.current.color.copy(currentColor.current)
    lightRef.current.intensity = 1.5 + Math.sin(Date.now() * 0.001) * 0.3
  })

  return <pointLight ref={lightRef} position={[0, -0.8, 0]} intensity={1.5} distance={4} />
}

// ─── 3D Model ─────────────────────────────────────────────────────────────────
function EldenModel({ url, visible }) {
  const gltf = useGLTF(url)
  const groupRef = useRef()

  const { object, scale } = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((node) => {
      if (!node.isMesh) return
      node.castShadow = true
      node.receiveShadow = true
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        mats.forEach((m) => {
          m.side = THREE.DoubleSide
          m.envMapIntensity = Math.max(m.envMapIntensity || 0, 1.1)
          m.needsUpdate = true
        })
      }
    })
    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z) || 1
    root.position.sub(center)
    return { object: root, scale: 3 / longest }
  }, [gltf.scene])

  // Fade in
  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.traverse(n => {
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material]
        mats.forEach(m => {
          m.transparent = true
          m.opacity = THREE.MathUtils.lerp(m.opacity || 0, visible ? 1 : 0, 0.08)
        })
      }
    })
  })

  return (
    <group ref={groupRef} scale={scale} position={[0, -0.2, 0]}>
      <primitive object={object} />
    </group>
  )
}

// ─── Annotations 3D ───────────────────────────────────────────────────────────
function Annotations({ annotations, visible }) {
  if (!visible || !annotations?.length) return null
  return (
    <>
      {annotations.map((ann) => (
        <Html
          key={ann.id}
          position={ann.position || [0, 2, 0]}
          distanceFactor={5}
          occlude
          style={{ pointerEvents: 'none' }}
        >
          <div className="annotation-pin">
            <span className="annotation-number">{ann.id}</span>
            <span className="annotation-label">{ann.label}</span>
          </div>
        </Html>
      ))}
    </>
  )
}

// ─── Viewer controls bar ──────────────────────────────────────────────────────
function ViewerControls({ autoRotate, onToggleRotate, onResetView, onScreenshot, showAnnotations, onToggleAnnotations, hasAlt, altActive, onToggleAlt, onFullscreen }) {
  return (
    <div className="viewer-controls-bar">
      <button type="button" className={autoRotate ? 'vc-btn active' : 'vc-btn'} onClick={onToggleRotate} title="Toggle rotation (Space)">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
          <path d="M4 10a6 6 0 1 0 6-6" />
          <polyline points="1,7 4,10 7,7" />
        </svg>
        <span>Rotation</span>
      </button>

      <button type="button" className="vc-btn" onClick={onResetView} title="Reset view">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
          <path d="M3 10a7 7 0 1 0 7-7" />
          <polyline points="3,3 3,10 10,10" />
        </svg>
        <span>Reset</span>
      </button>

      <button type="button" className="vc-btn" onClick={onScreenshot} title="Screenshot">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
          <rect x="2" y="5" width="16" height="12" rx="1.5" />
          <circle cx="10" cy="11" r="3" />
          <path d="M7 5l1.5-2h3L13 5" />
        </svg>
        <span>Screenshot</span>
      </button>

      <button type="button" className={showAnnotations ? 'vc-btn active' : 'vc-btn'} onClick={onToggleAnnotations} title="Toggle annotations (A)">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
          <circle cx="10" cy="10" r="7" />
          <line x1="10" y1="7" x2="10" y2="10" />
          <circle cx="10" cy="13" r="0.8" fill="currentColor" />
        </svg>
        <span>Annotations</span>
      </button>

      {hasAlt && (
        <button type="button" className={altActive ? 'vc-btn active' : 'vc-btn'} onClick={onToggleAlt} title="Switch phase">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
            <path d="M4 10h12M12 6l4 4-4 4" />
          </svg>
          <span>{altActive ? 'Phase 2' : 'Phase 1'}</span>
        </button>
      )}

      <button type="button" className="vc-btn" onClick={onFullscreen} title="Fullscreen (F)">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
          <path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" />
        </svg>
        <span>Plein écran</span>
      </button>
    </div>
  )
}

// ─── Scene inner (accès à la caméra et au gl via hooks) ───────────────────────
function SceneInner({ modelUrl, altUrl, altActive, autoRotate, difficulty, annotations, showAnnotations, orbitRef, glRef }) {
  const { camera, gl } = useThree()

  // Expose reset + screenshot callbacks via ref
  useEffect(() => {
    if (glRef) glRef.current = gl
  }, [gl, glRef])

  const auraColor = AURA_COLORS[difficulty] || AURA_COLORS[3]
  const activeUrl = altActive && altUrl ? altUrl : modelUrl

  return (
    <>
      <color attach="background" args={['#050608']} />
      <fogExp2 attach="fog" color="#050608" density={0.08} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 4]} intensity={2.8} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <directionalLight position={[-4, 3, -3]} intensity={1.2} color="#8fb5ff" />
      <pointLight position={[0, 2, 5]} intensity={0.7} color="#ffddb0" />

      <AuraLight difficulty={difficulty} />
      <AshParticles color={auraColor} count={50} />

      <Suspense fallback={null}>
        {activeUrl && <EldenModel url={activeUrl} visible={true} />}
        <Environment preset="night" />
      </Suspense>

      {annotations && <Annotations annotations={annotations} visible={showAnnotations} />}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}>
        <circleGeometry args={[5, 64]} />
        <meshStandardMaterial color="#0a0a10" roughness={0.9} metalness={0.3} />
      </mesh>

      <OrbitControls
        ref={orbitRef}
        enablePan enableZoom enableDamping
        dampingFactor={0.08}
        minDistance={2.5} maxDistance={10}
        target={[0, 1, 0]}
        autoRotate={autoRotate} autoRotateSpeed={0.8}
      />

      <EffectComposer>
        <Bloom luminanceThreshold={0.6} luminanceSmoothing={0.4} intensity={0.6} />
        <Vignette eskil={false} offset={0.35} darkness={0.7} />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={[0.0008, 0.0008]}
        />
      </EffectComposer>
    </>
  )
}

// ─── Viewer ───────────────────────────────────────────────────────────────────
function Viewer({ modelUrl, altUrl, autoRotate, bossName, difficulty, annotations, onResetView, onScreenshot, orbitRef, glRef, showAnnotations, onToggleAnnotations, onToggleRotate, hasAlt, altActive, onToggleAlt, onFullscreen }) {
  const [ready, setReady] = useState(false)
  const [showTip, setShowTip] = useState(true)
  const wrapperRef = useRef()

  useEffect(() => {
    setReady(false)
    setShowTip(true)
    const t1 = setTimeout(() => setReady(true), 80)
    const t2 = setTimeout(() => setShowTip(false), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [modelUrl])

  if (!modelUrl || modelUrl.trim() === '') {
    return (
      <div className="empty-viewer">
        <div className="empty-viewer-icon">⬡</div>
        <p>Aucun modèle 3D disponible</p>
        <span>Le modèle GLB pour ce boss n'a pas encore été ajouté</span>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={`viewer-wrapper ${ready ? 'viewer-ready' : ''}`} onClick={() => setShowTip(false)}>
      <ViewerErrorBoundary key={modelUrl}>
        <Canvas
          className="viewer-canvas"
          camera={{ position: [0, 1.6, 5], fov: 40 }}
          shadows
          dpr={[1, 1.25]}
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <SceneInner
            modelUrl={modelUrl}
            altUrl={altUrl}
            altActive={altActive}
            autoRotate={autoRotate}
            difficulty={difficulty}
            annotations={annotations}
            showAnnotations={showAnnotations}
            orbitRef={orbitRef}
            glRef={glRef}
          />
        </Canvas>
      </ViewerErrorBoundary>

      {/* Tip overlay */}
      {showTip && (
        <div className="viewer-tip">
          Drag to rotate · Scroll to zoom · Ctrl+drag to pan
        </div>
      )}

      {/* Boss name */}
      {bossName && <div className="viewer-boss-name">{bossName}</div>}

      {/* Controls bar */}
      <ViewerControls
        autoRotate={autoRotate}
        onToggleRotate={onToggleRotate}
        onResetView={onResetView}
        onScreenshot={onScreenshot}
        showAnnotations={showAnnotations}
        onToggleAnnotations={onToggleAnnotations}
        hasAlt={hasAlt}
        altActive={altActive}
        onToggleAlt={onToggleAlt}
        onFullscreen={onFullscreen}
      />
    </div>
  )
}

// ─── Difficulty Stars ─────────────────────────────────────────────────────────
function DifficultyStars({ value, onChange }) {
  const labels = ['', 'Facile', 'Accessible', 'Modéré', 'Difficile', 'Cauchemar']
  return (
    <div className="diff-stars">
      {[1,2,3,4,5].map((v) => (
        <button key={v} type="button"
          className={v <= value ? 'star active' : 'star'}
          onClick={onChange ? () => onChange(v) : undefined}
          style={onChange ? {} : { cursor: 'default', pointerEvents: 'none' }}
          aria-label={`Difficulté ${v}/5`}
          title={labels[v]}
        >★</button>
      ))}
      {value > 0 && <span className="diff-label">{labels[value] || ''}</span>}
    </div>
  )
}

// ─── Cards Zones ──────────────────────────────────────────────────────────────
function CardsZones({ info }) {
  const cards = [
    { key: 'arena',  icon: '⌖', label: 'Arène',          value: info.arena  || info.area },
    { key: 'weapon', icon: '⚔', label: 'Arme signature', value: info.weapon || info.keyMoves },
    { key: 'lore',   icon: '📜', label: 'Lore',           value: info.lore   || info.affiliation },
    { key: 'drops',  icon: '◈', label: 'Drops',          value: info.drops },
  ]

  const filled = cards.filter(c => c.value)
  if (!filled.length) return null

  return (
    <div className="cards-zones">
      {filled.map(card => (
        <div key={card.key} className={`cz-card cz-${card.key}`}>
          <div className="cz-header">
            <span className="cz-icon">{card.icon}</span>
            <span className="cz-label">{card.label}</span>
          </div>
          <p className="cz-value">{card.value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Info Pane ────────────────────────────────────────────────────────────────
function InfoPane({ model, onUpdateInfo }) {
  const [editMode, setEditMode] = useState(false)
  const info = ensureInfo(model)

  useEffect(() => setEditMode(false), [model?.id])

  if (!model) {
    return (
      <div className="info-empty">
        <div className="info-empty-icon">⬡</div>
        <p>Sélectionne un boss dans la liste</p>
      </div>
    )
  }

  const tagList = (info.tags || '').split(',').map(t => t.trim()).filter(Boolean)

  const field = (label, key, multiline = false, rows = 2, placeholder = '') => (
    <div className="info-field" key={key}>
      <span className="info-field-label">{label}</span>
      {editMode ? (
        multiline
          ? <textarea rows={rows} value={info[key] || ''} placeholder={placeholder} onChange={e => onUpdateInfo(model.id, { [key]: e.target.value })} />
          : <input type="text" value={info[key] || ''} placeholder={placeholder} onChange={e => onUpdateInfo(model.id, { [key]: e.target.value })} />
      ) : (
        <span className="info-field-value">{info[key] || <em className="info-empty-val">—</em>}</span>
      )}
    </div>
  )

  return (
    <>
      <div className="info-header">
        <div className="info-header-main">
          <h2 className="info-boss-name">{info.title || model.name}</h2>
          <p className="info-boss-role">{info.role || 'Boss'}</p>
          <DifficultyStars
            value={info.difficulty || 3}
            onChange={editMode ? (v) => onUpdateInfo(model.id, { difficulty: v }) : null}
          />
        </div>
        <button type="button" className={`edit-toggle ${editMode ? 'active' : ''}`}
          onClick={() => setEditMode(v => !v)}
          title={editMode ? 'Terminer l\'édition' : 'Modifier la fiche'}
        >
          {editMode ? '✓ Fermer' : '✎ Éditer'}
        </button>
      </div>

      <div className="info-badges">
        {info.area && <span className="info-badge"><span className="badge-icon">⌖</span>{info.area}</span>}
        {info.recommendedLevel && <span className="info-badge badge-level"><span className="badge-icon">◈</span>Niv. {info.recommendedLevel}</span>}
        {info.affiliation && <span className="info-badge badge-affil"><span className="badge-icon">⚑</span>{info.affiliation}</span>}
      </div>

      <div className="info-sections">
        <details className="info-accordion" open>
          <summary>Style de combat</summary>
          <div className="info-accordion-body">
            {field('Description générale', 'fightStyle', true, 3)}
          </div>
        </details>

        <details className="info-accordion" open>
          <summary>Attaques clés</summary>
          <div className="info-accordion-body">
            {field('Patterns & attaques', 'keyMoves', true, 3, 'Combos, phases, mouvements dangereux...')}
          </div>
        </details>

        <details className="info-accordion" open>
          <summary>Stratégie</summary>
          <div className="info-accordion-body">
            {field('Conseils & builds', 'strategyNotes', true, 3, 'Build recommandé, invocations, timing...')}
          </div>
        </details>

        {editMode && (
          <details className="info-accordion" open>
            <summary>Infos avancées</summary>
            <div className="info-accordion-body">
              {field('Nom / titre', 'title')}
              {field('Rôle', 'role')}
              <div className="info-field-row">
                {field('Zone / région', 'area')}
                {field('Niveau recommandé', 'recommendedLevel', false, 1, 'ex: 120+')}
              </div>
              {field('Affiliation', 'affiliation')}
              {field('Arène (description)', 'arena', true, 2)}
              {field('Arme signature', 'weapon', false, 1)}
              {field('Lore', 'lore', true, 3)}
              {field('Drops', 'drops', false, 1)}
              {field('Tags (virgule)', 'tags', false, 1, 'shardbearer, bleed, late game')}
            </div>
          </details>
        )}
      </div>

      {tagList.length > 0 && (
        <div className="tag-list">
          {tagList.map(tag => <span key={tag} className="tag-pill">{tag}</span>)}
        </div>
      )}

      {/* Lore card */}
      {info.lore && (
        <div className="lore-card">
          <span className="lore-card-label">Lore</span>
          <p className="lore-card-text">{info.lore}</p>
        </div>
      )}
    </>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [models, setModels]         = useState(() => loadStoredModels())
  const [selectedId, setSelectedId] = useState(() => getBossFromUrl() || loadStoredSelected())
  const [autoRotate, setAutoRotate] = useState(true)
  const [search, setSearch]         = useState('')
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [altActive, setAltActive]   = useState(false)
  const [mobilePanel, setMobilePanel] = useState('viewer')

  const orbitRef = useRef()
  const glRef    = useRef()

  const selectedModel = models.find(m => m.id === selectedId) || models[0]
  const selectedInfo  = ensureInfo(selectedModel)

  // Persist models
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(models)) } catch {}
  }, [models])

  // Persist selection + URL
  useEffect(() => {
    if (!selectedId) return
    try { window.localStorage.setItem(SELECTED_KEY, selectedId) } catch {}
    setBossInUrl(selectedId)
    setAltActive(false)
  }, [selectedId])

  // Load library.json
  useEffect(() => {
    let cancelled = false
    async function loadLibrary() {
      try {
        const res = await fetch(LIBRARY_URL)
        if (!res.ok) return
        const data = await res.json()
        if (!Array.isArray(data)) return
        setModels(current => {
          const byId = new Map(current.map(m => [m.id, m]))
          const merged = [...current]
          data.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') return
            const id   = entry.id || `builtin-${index}`
            const name = entry.name || 'Inconnu'
            const info = { ...DEFAULT_INFO, ...(entry.info || {}), title: entry.info?.title || name }
            let canonicalUrl = ''
            const isRemote = entry.remoteUrl && entry.remoteUrl.trim() !== '' && !entry.remoteUrl.startsWith('REMPLACE')
            if (isRemote) canonicalUrl = withCorsProxy(entry.remoteUrl)
            else if (entry.modelPath && entry.modelPath.trim() !== '')
              canonicalUrl = `${import.meta.env.BASE_URL}${entry.modelPath.replace(/^\//, '')}`

            // Alt URL (phase 2)
            let altUrl = ''
            const hasAltRemote = entry.remoteUrl2 && entry.remoteUrl2.trim() !== ''
            if (hasAltRemote) altUrl = withCorsProxy(entry.remoteUrl2)
            else if (entry.modelPath2 && entry.modelPath2.trim() !== '')
              altUrl = `${import.meta.env.BASE_URL}${entry.modelPath2.replace(/^\//, '')}`

            const source = isRemote ? 'remote' : 'builtin'
            const existing = byId.get(id) || merged.find(m => m.name === name)
            if (existing) {
              existing.info = { ...ensureInfo(existing), ...info }
              if (canonicalUrl && existing.source !== 'upload') {
                existing.url = canonicalUrl
                existing.source = source
              }
              if (altUrl) existing.altUrl = altUrl
            } else {
              merged.push({ id, name, url: canonicalUrl, altUrl, source, info })
            }
          })
          return merged
        })
      } catch {}
    }
    if (!cancelled) loadLibrary()
    return () => { cancelled = true }
  }, [])

  // Update model info
  const updateModelInfo = useCallback((id, patch) => {
    setModels(current => current.map(m =>
      m.id === id ? { ...m, info: { ...DEFAULT_INFO, ...(m.info || {}), ...patch } } : m
    ))
  }, [])

  // Reset camera
  const handleResetView = useCallback(() => {
    if (!orbitRef.current) return
    orbitRef.current.reset()
  }, [])

  // Screenshot
  const handleScreenshot = useCallback(() => {
    if (!glRef.current) return
    const canvas = glRef.current.domElement
    const link = document.createElement('a')
    link.download = `${selectedId || 'boss'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [selectedId])

  // Fullscreen
  const handleFullscreen = useCallback(() => {
    const el = document.querySelector('.viewer-panel') || document.querySelector('.main-pane')
    if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => {})
    else document.exitFullscreen()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const idx = models.findIndex(m => m.id === selectedId)
      switch (e.key) {
        case 'ArrowLeft':
          if (idx > 0) setSelectedId(models[idx - 1].id)
          break
        case 'ArrowRight':
          if (idx < models.length - 1) setSelectedId(models[idx + 1].id)
          break
        case ' ':
          e.preventDefault()
          setAutoRotate(v => !v)
          break
        case 'a': case 'A':
          setShowAnnotations(v => !v)
          break
        case 'f': case 'F':
          handleFullscreen()
          break
        case 'Escape':
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [models, selectedId, handleFullscreen])

  const filteredModels = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return models
    return models.filter(m => {
      const info = ensureInfo(m)
      return (
        (info.title || m.name).toLowerCase().includes(q) ||
        (info.tags  || '').toLowerCase().includes(q) ||
        (info.area  || '').toLowerCase().includes(q) ||
        (info.role  || '').toLowerCase().includes(q)
      )
    })
  }, [models, search])

  const handleSelectModel = (id) => {
    setSelectedId(id)
    setMobilePanel('viewer')
  }

  const hasAlt = !!(selectedModel?.altUrl)

  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header-brand">
          <svg className="brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <polygon points="12,2 22,20 2,20" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
            <line x1="12" y1="8" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="17.5" r="1" fill="currentColor" />
          </svg>
          <div>
            <h1>Elden Ring 3D Forge</h1>
            <p>Codex interactif des boss des Terres Intermédiaires</p>
          </div>
        </div>
        <div className="app-header-actions">
          <span className="boss-count">{models.length} boss</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-search">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14" className="search-icon">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <line x1="13" y1="13" x2="17" y2="17" />
            </svg>
            <input
              type="search"
              placeholder="Rechercher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Rechercher un boss"
            />
          </div>
          <div className="sidebar-count">{filteredModels.length} / {models.length}</div>
          <ul className="model-list">
            {filteredModels.length === 0 && (
              <li className="model-empty">Aucun résultat pour « {search} »</li>
            )}
            {filteredModels.map(model => {
              const info = ensureInfo(model)
              const diff = info.difficulty || 0
              const hasModel = !!model.url
              const hasAltModel = !!model.altUrl
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    className={`model-item ${selectedModel?.id === model.id ? 'active' : ''}`}
                    onClick={() => handleSelectModel(model.id)}
                  >
                    <div className="model-item-top">
                      <span
                        className="model-diff-dot"
                        style={{ background: AURA_COLORS[diff] || AURA_COLORS[0] }}
                        title={`Difficulté ${diff}/5`}
                      />
                      <span className="model-name">{info.title || model.name}</span>
                      <div className="model-item-dots">
                        {hasAltModel && <span className="model-alt-dot" title="Phase 2 disponible">②</span>}
                        <span className={`model-glb-dot ${hasModel ? 'has-model' : ''}`} title={hasModel ? 'Modèle 3D disponible' : 'Pas de modèle 3D'} />
                      </div>
                    </div>
                    <div className="model-item-bottom">
                      <span className="model-area">{info.area || ''}</span>
                      <div className="model-diff">
                        {[1,2,3,4,5].map(v => <span key={v} className={v <= diff ? 'ds active' : 'ds'}>★</span>)}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        {/* Main pane */}
        <main className="main-pane">
          {/* Mobile tabs */}
          <div className="mobile-tabs">
            <button type="button" className={mobilePanel === 'viewer' ? 'active' : ''} onClick={() => setMobilePanel('viewer')}>⬡ Modèle 3D</button>
            <button type="button" className={mobilePanel === 'info'   ? 'active' : ''} onClick={() => setMobilePanel('info')}>✦ Fiche boss</button>
          </div>

          {/* Viewer */}
          <section className={`viewer-panel${mobilePanel === 'viewer' ? ' visible' : ''}`}>
            <Viewer
              modelUrl={selectedModel?.url}
              altUrl={selectedModel?.altUrl}
              autoRotate={autoRotate}
              bossName={selectedModel ? (selectedInfo.title || selectedModel.name) : ''}
              difficulty={selectedInfo.difficulty || 3}
              annotations={selectedInfo.annotations || []}
              showAnnotations={showAnnotations}
              onToggleAnnotations={() => setShowAnnotations(v => !v)}
              onToggleRotate={() => setAutoRotate(v => !v)}
              onResetView={handleResetView}
              onScreenshot={handleScreenshot}
              orbitRef={orbitRef}
              glRef={glRef}
              hasAlt={hasAlt}
              altActive={altActive}
              onToggleAlt={() => setAltActive(v => !v)}
              onFullscreen={handleFullscreen}
            />
          </section>

          {/* Cards Zones — sous le viewer */}
          {selectedModel && (
            <div className={`cards-zones-wrapper${mobilePanel === 'viewer' ? ' visible' : ''}`}>
              <CardsZones info={selectedInfo} />
            </div>
          )}

          {/* Info panel mobile */}
          <section className={`mobile-info-panel${mobilePanel === 'info' ? ' visible' : ''}`}>
            <InfoPane model={selectedModel} onUpdateInfo={updateModelInfo} />
          </section>
        </main>

        {/* Info pane desktop */}
        <aside className="info-pane">
          <InfoPane model={selectedModel} onUpdateInfo={updateModelInfo} />
        </aside>
      </div>
    </div>
  )
}

export default App
