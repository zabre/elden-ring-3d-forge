import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

const LIBRARY_URL = `${import.meta.env.BASE_URL}library.json`
const AURA_COLORS = ['#ffffff', '#4a90d9', '#4caf7d', '#e0a030', '#e06020', '#c0392b']

function ensureInfo(model) {
  return { title: model?.name || '', difficulty: 3, ...model?.info }
}

function withCorsProxy(url) {
  if (!url) return url
  if (url.includes('drive.google.com')) return `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  return url
}

function useModelCache(models, selectedId) {
  const cacheRef = useRef([])
  useEffect(() => {
    const urlsToKeep = []
    const selected = models.find(m => m.id === selectedId)
    if (selected?.url) urlsToKeep.push(selected.url)
    if (selected?.altUrl) urlsToKeep.push(selected.altUrl)

    urlsToKeep.forEach(url => {
      if (!cacheRef.current.includes(url)) cacheRef.current.push(url)
    })

    while (cacheRef.current.length > 5) {
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

function CardsZones({ info }) {
  return (
    <div className="bottom-panels">
      <div className="bp-card bp-large">
        <div className="bp-header">
          <span className="bp-icon">⌖</span>
          <span className="bp-title">Arène & Environnement</span>
        </div>
        <div className="bp-content">
          <div className="bp-media-slot" style={{ backgroundImage: info.arenaImage ? `url(${info.arenaImage})` : 'none' }}>
            {!info.arenaImage && <span className="bp-media-placeholder">Média Arène</span>}
          </div>
          <div className="bp-text">{info.arena || info.area || "Informations sur l'arène indisponibles."}</div>
        </div>
      </div>

      <div className="bp-card bp-large">
        <div className="bp-header">
          <span className="bp-icon">⚔</span>
          <span className="bp-title">Arsenal & Mouvements</span>
        </div>
        <div className="bp-content">
          <div className="bp-media-slot" style={{ backgroundImage: info.weaponImage ? `url(${info.weaponImage})` : 'none' }}>
            {!info.weaponImage && <span className="bp-media-placeholder">Média Arme</span>}
          </div>
          <div className="bp-text">{info.weapon || info.keyMoves || "Informations sur l'arme indisponibles."}</div>
        </div>
      </div>

      <div className="bp-card bp-small">
        <div className="bp-header">
          <span className="bp-icon">◈</span>
          <span className="bp-title">Butin</span>
        </div>
        <div className="bp-content">
          <div className="bp-text">{info.drops || "Aucun butin répertorié."}</div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [models, setModels] = useState([])
  const [selectedId, setSelectedId] = useState(new URLSearchParams(window.location.search).get('boss') || 'margit')
  const [search, setSearch] = useState('')
  const [filterDiff, setFilterDiff] = useState(0)
  
  const [autoRotate, setAutoRotate] = useState(true)
  const [altActive, setAltActive] = useState(false)
  const [showTip, setShowTip] = useState(true)

  const orbitRef = useRef(); const glRef = useRef()
  const selectedModel = models.find(m => m.id === selectedId) || models[0]
  
  useModelCache(models, selectedId)

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
      <header className="app-header">
        <div className="app-header-brand">
          <svg className="brand-icon" viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" stroke="currentColor" fill="none" /></svg>
          <div><h1>Elden Ring 3D Forge</h1><p>Codex interactif des Terres Intermédiaires</p></div>
        </div>
        <span className="boss-count">{models.length} boss</span>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-search">
            <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="sidebar-filters">
            <details>
              <summary>Filtres & Tags</summary>
              <div className="filter-options">
                {[0,1,2,3,4,5].map(d => (
                  <button key={d} className={`filter-btn ${filterDiff===d ? 'active':''}`} onClick={() => setFilterDiff(d)}>{d === 0 ? 'Tous' : `${d}★`}</button>
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

        <main className="main-pane" onPointerDown={() => setShowTip(false)}>
          <div className="viewer-wrapper">
            <Canvas className="viewer-canvas" camera={{ position: [0, 1.5, 6], fov: 45 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, preserveDrawingBuffer: true }}>
              <Scene selected={selectedModel} altActive={altActive} autoRotate={autoRotate} orbitRef={orbitRef} glRef={glRef} />
            </Canvas>

            {showTip && <div className="viewer-tip">Drag to rotate · Scroll to zoom · Ctrl+drag to pan</div>}
            
            {/* Nouveau Selecteur de Phase Visuel */}
            {selectedModel?.altUrl && (
              <div className="phase-switcher">
                <button className={`ps-btn ${!altActive ? 'active' : ''}`} onClick={() => setAltActive(false)}>Phase 1</button>
                <button className={`ps-btn ${altActive ? 'active' : ''}`} onClick={() => setAltActive(true)}>Phase 2</button>
              </div>
            )}

            {!selectedModel?.url && (
              <div className="viewer-error">
                <div className="viewer-error-icon">⚠</div>
                <p>Le modèle a sombré dans les Terres Intermédiaires</p>
              </div>
            )}

            <div className="viewer-controls-bar">
              <button className={`vc-btn ${autoRotate?'active':''}`} onClick={() => setAutoRotate(!autoRotate)} title="Space">⟲ Rotate</button>
              <button className="vc-btn" onClick={() => orbitRef.current?.reset()}>◉ Reset</button>
            </div>
          </div>

          {selectedModel && <CardsZones info={ensureInfo(selectedModel)} />}
        </main>

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
              <details className="info-accordion" open>
                <summary>Lore</summary>
                <div className="info-accordion-body">
                  <div className="info-field-value" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                    {ensureInfo(selectedModel).lore || "Aucune archive trouvée."}
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
