import React, {
  Component, Suspense, useCallback, useEffect,
  useMemo, useRef, useState
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF, Html } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration, Pixelation } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

// ─── Constantes & Setup ────────────────────────────────────────────────────────
const LIBRARY_URL = `${import.meta.env.BASE_URL}library.json`
const AURA_COLORS = ['#ffffff', '#4a90d9', '#4caf7d', '#e0a030', '#e06020', '#c0392b']

// Détection URL ?annotate=1
const IS_ANNOTATE_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('annotate') === '1'

function ensureInfo(model) {
  return { title: model?.name || '', difficulty: 3, annotations: [], ...model?.info }
}

function withCorsProxy(url) {
  if (!url) return url
  if (url.includes('drive.google.com')) return `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  return url
}

// ─── Cache GLB Intelligent ────────────────────────────────────────────────────
function useModelCache(models, selectedId, compareId) {
  const cacheRef = useRef([])

  useEffect(() => {
    const urlsToKeep = []
    
    // Garder en mémoire le sélectionné, sa phase 2, et la comparaison
    const selected = models.find(m => m.id === selectedId)
    const compare = models.find(m => m.id === compareId)
    
    if (selected?.url) urlsToKeep.push(selected.url)
    if (selected?.altUrl) urlsToKeep.push(selected.altUrl)
    if (compare?.url) urlsToKeep.push(compare.url)

    // Précharger le boss suivant silencieusement
    const nextIdx = models.findIndex(m => m.id === selectedId) + 1
    if (models[nextIdx]?.url) {
      urlsToKeep.push(models[nextIdx].url)
      try { useGLTF.preload(models[nextIdx].url) } catch {}
    }

    urlsToKeep.forEach(url => {
      if (!cacheRef.current.includes(url)) cacheRef.current.push(url)
    })

    // Éliminer les anciens GLB (garde les 5 derniers)
    while (cacheRef.current.length > 5) {
      const oldest = cacheRef.current.shift()
      if (!urlsToKeep.includes(oldest)) {
        try { useGLTF.clear(oldest) } catch {}
      }
    }
  }, [models, selectedId, compareId])
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ViewerErrorBoundary extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidUpdate(prevProps) { if (prevProps.url !== this.props.url) this.setState({ hasError: false }) }
  render() {
    if (this.state.hasError) return null // L'UI externe gérera le texte d'erreur
    return this.props.children
  }
}

// ─── Éléments 3D ──────────────────────────────────────────────────────────────
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
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.03} color={color} transparent opacity={0.6} sizeAttenuation />
    </points>
  )
}

function AuraLight({ difficulty, position }) {
  const color = new THREE.Color(AURA_COLORS[difficulty] || AURA_COLORS[3])
  return <pointLight position={position} intensity={2} distance={5} color={color} />
}

function Annotations({ data, visible }) {
  if (!visible || !data?.length) return null
  return data.map((ann) => (
    <Html key={ann.id} position={ann.position} distanceFactor={6} occlude style={{ pointerEvents: 'none' }}>
      <div className="annotation-pin">
        <span className="annotation-number">{ann.id}</span>
        <span className="annotation-label">{ann.label}</span>
      </div>
    </Html>
  ))
}

function EldenModel({ url, position = [0, 0, 0], annotations, showAnnotations }) {
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
          mats.forEach(m => { m.side = THREE.DoubleSide; m.envMapIntensity = 1.2 })
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

  // Transition d'entrée : Dissolution inverse depuis le sol (Y + Opacité)
  useFrame(() => {
    if (!groupRef.current) return
    const t = Math.min((Date.now() - spawnTime) / 600, 1) // 600ms
    const ease = 1 - Math.pow(1 - t, 3)
    
    groupRef.current.position.y = position[1] - 1 + ease
    groupRef.current.scale.setScalar(scale * (0.9 + ease * 0.1))

    if (t < 1) {
      groupRef.current.traverse(n => {
        if (n.isMesh && n.material) {
          const mats = Array.isArray(n.material) ? n.material : [n.material]
          mats.forEach(m => { m.transparent = true; m.opacity = ease; m.needsUpdate = true })
        }
      })
    }
  })

  // Mode placement d'annotation
  const handlePointerDown = (e) => {
    if (!IS_ANNOTATE_MODE) return
    e.stopPropagation()
    console.log(JSON.stringify({
      id: Math.floor(Math.random() * 100),
      label: "Nouveau Point",
      position: [parseFloat(e.point.x.toFixed(2)), parseFloat(e.point.y.toFixed(2)), parseFloat(e.point.z.toFixed(2))]
    }))
  }

  return (
    <group ref={groupRef} position={position} onPointerDown={handlePointerDown}>
      <primitive object={object} />
      <Annotations data={annotations} visible={showAnnotations} />
    </group>
  )
}

// ─── Scène Globale (Un seul Canvas) ───────────────────────────────────────────
function Scene({ 
  selected, compare, altActive, 
  autoRotate, showAnnotations, pixelArt, 
  orbitRef, glRef 
}) {
  const { gl } = useThree()
  useEffect(() => { if (glRef) glRef.current = gl }, [gl, glRef])

  const sUrl = altActive && selected?.altUrl ? selected.altUrl : selected?.url
  const sDiff = ensureInfo(selected).difficulty || 3

  const isCompare = !!compare
  const cUrl = compare?.url
  const cDiff = ensureInfo(compare).difficulty || 3

  return (
    <>
      <color attach="background" args={['#050608']} />
      <fogExp2 attach="fog" color="#050608" density={0.06} />
      
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 4]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 3, -3]} intensity={1.5} color="#8fb5ff" />

      {/* Sol à micro-réflexion */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]}>
        <circleGeometry args={[8, 64]} />
        <meshStandardMaterial color="#0a0a10" roughness={0.8} metalness={0.4} />
      </mesh>

      <Suspense fallback={null}>
        <Environment preset="night" />
        
        {/* Boss principal */}
        {sUrl && (
          <ViewerErrorBoundary url={sUrl}>
            <EldenModel 
              url={sUrl} 
              position={isCompare ? [-2.5, 0, 0] : [0, 0, 0]} 
              annotations={ensureInfo(selected).annotations} 
              showAnnotations={showAnnotations} 
            />
            <AuraLight difficulty={sDiff} position={isCompare ? [-2.5, -1, 0] : [0, -1, 0]} />
            <AshParticles color={AURA_COLORS[sDiff]} />
          </ViewerErrorBoundary>
        )}

        {/* Boss comparaison */}
        {isCompare && cUrl && (
          <ViewerErrorBoundary url={cUrl}>
            <EldenModel 
              url={cUrl} 
              position={[2.5, 0, 0]} 
              annotations={ensureInfo(compare).annotations} 
              showAnnotations={showAnnotations} 
            />
            <AuraLight difficulty={cDiff} position={[2.5, -1, 0]} />
            <AshParticles color={AURA_COLORS[cDiff]} />
          </ViewerErrorBoundary>
        )}
      </Suspense>

      <OrbitControls 
        ref={orbitRef} 
        enableDamping dampingFactor={0.05} 
        minDistance={3} maxDistance={12} 
        target={isCompare ? [0, 1, 0] : [0, 1, 0]}
        autoRotate={autoRotate} autoRotateSpeed={0.5} 
      />

      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.5} intensity={0.8} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.8} />
        <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.001, 0.001]} />
        {pixelArt && <Pixelation granularity={5} />}
      </EffectComposer>
    </>
  )
}

// ─── Composants UI ────────────────────────────────────────────────────────────
function CardsZones({ info }) {
  const cards = [
    { key: 'arena', icon: '⌖', label: 'Arène', value: info.arena || info.area },
    { key: 'weapon', icon: '⚔', label: 'Arme signature', value: info.weapon || info.keyMoves },
    { key: 'lore', icon: '📜', label: 'Lore', value: info.lore || info.affiliation },
    { key: 'drops', icon: '◈', label: 'Drops', value: info.drops }
  ].filter(c => c.value)

  if (!cards.length) return null
  return (
    <div className="cards-zones-wrapper">
      <div className="cards-zones">
        {cards.map(card => (
          <div key={card.key} className="cz-card">
            <div className="cz-header"><span className="cz-icon">{card.icon}</span><span className="cz-label">{card.label}</span></div>
            <p className="cz-value">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompareTable({ m1, m2 }) {
  const i1 = ensureInfo(m1); const i2 = ensureInfo(m2)
  return (
    <div className="compare-table">
      <div className="compare-col">
        <h3 style={{color: 'var(--gold)', fontSize:'0.9rem'}}>{i1.title}</h3>
        <div className="compare-stat"><span>Zone</span><strong>{i1.area || '-'}</strong></div>
        <div className="compare-stat"><span>Difficulté</span><strong>{i1.difficulty}/5</strong></div>
      </div>
      <div className="compare-col" style={{justifyContent: 'center'}}>
        <h2 style={{color:'var(--text-faint)', letterSpacing:'0.2em'}}>VS</h2>
      </div>
      <div className="compare-col">
        <h3 style={{color: 'var(--gold)', fontSize:'0.9rem'}}>{i2.title}</h3>
        <div className="compare-stat"><span>Zone</span><strong>{i2.area || '-'}</strong></div>
        <div className="compare-stat"><span>Difficulté</span><strong>{i2.difficulty}/5</strong></div>
      </div>
    </div>
  )
}

// ─── App Principale ───────────────────────────────────────────────────────────
export default function App() {
  const [models, setModels] = useState([])
  const [selectedId, setSelectedId] = useState(new URLSearchParams(window.location.search).get('boss') || 'margit')
  const [compareId, setCompareId] = useState(null)
  
  const [search, setSearch] = useState('')
  const [filterDiff, setFilterDiff] = useState(0)
  
  const [autoRotate, setAutoRotate] = useState(true)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [altActive, setAltActive] = useState(false)
  const [pixelArt, setPixelArt] = useState(false)
  const [showTip, setShowTip] = useState(true)

  const orbitRef = useRef(); const glRef = useRef()

  const selectedModel = models.find(m => m.id === selectedId) || models[0]
  const compareModel = models.find(m => m.id === compareId)
  
  useModelCache(models, selectedId, compareId)

  // Chargement
  useEffect(() => {
    fetch(LIBRARY_URL).then(r => r.json()).then(data => {
      const parsed = data.map((m, i) => ({
        ...m, 
        id: m.id || `boss-${i}`,
        url: withCorsProxy(m.remoteUrl) || (m.modelPath ? `${import.meta.env.BASE_URL}${m.modelPath}` : ''),
        altUrl: withCorsProxy(m.remoteUrl2) || (m.modelPath2 ? `${import.meta.env.BASE_URL}${m.modelPath2}` : '')
      }))
      setModels(parsed)
    })
  }, [])

  // Update URL
  useEffect(() => {
    if (selectedId) {
      const url = new URL(window.location)
      url.searchParams.set('boss', selectedId)
      window.history.pushState({}, '', url)
      setAltActive(false); setCompareId(null)
      setShowTip(true)
      setTimeout(() => setShowTip(false), 3000)
    }
  }, [selectedId])

  // Raccourcis clavier
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const idx = models.findIndex(m => m.id === selectedId)
      switch(e.key.toLowerCase()) {
        case 'arrowleft': if (idx > 0) setSelectedId(models[idx - 1].id); break
        case 'arrowright': if (idx < models.length - 1) setSelectedId(models[idx + 1].id); break
        case ' ': e.preventDefault(); setAutoRotate(v => !v); break
        case 'a': setShowAnnotations(v => !v); break
        case 'p': setPixelArt(v => !v); break
        case 'f': document.querySelector('.main-pane')?.requestFullscreen().catch(()=>{}); break
        case 'escape': setCompareId(null); break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [models, selectedId])

  // Filtrage
  const filteredModels = useMemo(() => {
    let res = models
    if (filterDiff > 0) res = res.filter(m => ensureInfo(m).difficulty === filterDiff)
    if (search) res = res.filter(m => (m.name + ensureInfo(m).tags).toLowerCase().includes(search.toLowerCase()))
    return res
  }, [models, search, filterDiff])

  // Boss similaires (pour le panel droit)
  const similarBosses = useMemo(() => {
    if (!selectedModel) return []
    const info = ensureInfo(selectedModel)
    return models.filter(m => m.id !== selectedId && (ensureInfo(m).area === info.area || ensureInfo(m).difficulty === info.difficulty)).slice(0, 2)
  }, [selectedModel, models, selectedId])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <svg className="brand-icon" viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" stroke="currentColor" fill="none" /></svg>
          <div><h1>Elden Ring 3D Forge</h1><p>Codex interactif des Terres Intermédiaires</p></div>
        </div>
        <span className="boss-count">{models.length} boss</span>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-search">
            <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="sidebar-filters">
            <details>
              <summary>Filtres & Tags</summary>
              <div className="filter-options">
                {[0,1,2,3,4,5].map(d => (
                  <button key={d} className={`filter-btn ${filterDiff===d ? 'active':''}`} onClick={() => setFilterDiff(d)}>
                    {d === 0 ? 'Tous' : `${d}★`}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <ul className="model-list">
            {filteredModels.map(m => {
              const diff = ensureInfo(m).difficulty || 0
              return (
                <li key={m.id}>
                  <button className={`model-item ${selectedId === m.id ? 'active' : ''}`} onClick={() => setSelectedId(m.id)}>
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

        {/* Viewer 3D Persistant */}
        <main className="main-pane" onPointerDown={() => setShowTip(false)}>
          <div className="viewer-wrapper">
            <Canvas 
              className="viewer-canvas" 
              camera={{ position: [0, 1.5, 6], fov: 45 }} 
              gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, preserveDrawingBuffer: true }}
            >
              <Scene 
                selected={selectedModel} compare={compareModel} altActive={altActive}
                autoRotate={autoRotate} showAnnotations={showAnnotations} pixelArt={pixelArt}
                orbitRef={orbitRef} glRef={glRef}
              />
            </Canvas>

            {/* Overlays */}
            {showTip && <div className="viewer-tip">Drag to rotate · Scroll to zoom · Ctrl+drag to pan</div>}
            {pixelArt && <div className="pixel-art-indicator">Pixel Art ON</div>}
            {!compareId && <div className="viewer-boss-name">{selectedModel?.name}</div>}

            {!selectedModel?.url && (
              <div className="viewer-error">
                <div className="viewer-error-icon">⚠</div>
                <p>Le modèle a sombré dans les Terres Intermédiaires</p>
              </div>
            )}

            {/* Barre de contrôles inline */}
            <div className="viewer-controls-bar">
              <button className={`vc-btn ${autoRotate?'active':''}`} onClick={() => setAutoRotate(!autoRotate)} title="Space">⟲ Rotate</button>
              <button className="vc-btn" onClick={() => orbitRef.current?.reset()}>◉ Reset</button>
              <button className={`vc-btn ${showAnnotations?'active':''}`} onClick={() => setShowAnnotations(!showAnnotations)} title="A">⌖ Annotations</button>
              {selectedModel?.altUrl && !compareId && (
                <button className={`vc-btn ${altActive?'active':''}`} onClick={() => setAltActive(!altActive)}>② Phase 2</button>
              )}
              {compareId && <button className="vc-btn active" onClick={() => setCompareId(null)} title="Esc">✕ Quitter Comparaison</button>}
            </div>
          </div>

          {/* Zones UI du bas */}
          {compareId ? <CompareTable m1={selectedModel} m2={compareModel} /> : (selectedModel && <CardsZones info={ensureInfo(selectedModel)} />)}
        </main>

        {/* Panneau Droit (Info) */}
        <aside className="info-pane">
          {selectedModel && (
            <>
              <div className="info-header">
                <h2 className="info-boss-name">{ensureInfo(selectedModel).title}</h2>
                <div className="diff-stars">
                  {[1,2,3,4,5].map(v => <span key={v} className={`star ${v <= ensureInfo(selectedModel).difficulty ? 'active':''}`}>★</span>)}
                </div>
              </div>

              <details className="info-accordion" open>
                <summary>Style de combat</summary>
                <div className="info-accordion-body">
                  <div className="info-field-label">Patterns</div>
                  <div className="info-field-value">{ensureInfo(selectedModel).keyMoves}</div>
                  <div className="info-field-label" style={{marginTop: '0.5rem'}}>Stratégie</div>
                  <div className="info-field-value">{ensureInfo(selectedModel).strategyNotes}</div>
                </div>
              </details>

              {similarBosses.length > 0 && !compareId && (
                <div className="similar-bosses">
                  <span className="similar-label">Boss Similaires</span>
                  <div className="similar-grid">
                    {similarBosses.map(sb => (
                      <div key={sb.id} className="similar-card" onClick={() => setSelectedId(sb.id)}>
                        <span>{sb.name}</span>
                      </div>
                    ))}
                  </div>
                  <button className="compare-btn" onClick={() => setCompareId(similarBosses[0].id)}>Comparer ➔</button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
