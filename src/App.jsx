import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const STORAGE_KEY = 'er3d-library-v1'
const LIBRARY_URL = `${import.meta.env.BASE_URL}library.json`

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
  ) {
    return `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  }
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
  } catch {
    return []
  }
}

const DEFAULT_INFO = {
  title: '', role: '', area: '', affiliation: '',
  difficulty: 3, recommendedLevel: '',
  fightStyle: '', keyMoves: '', strategyNotes: '', tags: '',
}

function ensureInfo(model) {
  if (!model) return DEFAULT_INFO
  return { ...DEFAULT_INFO, ...(model.info || {}) }
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
        <p>Impossible de charger ce modèle</p>
        <span className="viewer-error-detail">{this.state.message}</span>
        <button type="button" onClick={() => this.setState({ hasError: false, message: '' })}>Réessayer</button>
      </div>
    )
    return this.props.children
  }
}

// ─── 3D Model ─────────────────────────────────────────────────────────────────
function EldenModel({ url }) {
  const gltf = useGLTF(url)
  const { object, scale } = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((node) => {
      if (!node.isMesh) return
      node.castShadow = true
      node.receiveShadow = true
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        mats.forEach((m) => { m.side = THREE.DoubleSide; m.envMapIntensity = Math.max(m.envMapIntensity || 0, 1.1); m.needsUpdate = true })
      }
    })
    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z) || 1
    root.position.sub(center)
    return { object: root, scale: 3 / longest }
  }, [gltf.scene])
  return <group scale={scale} position={[0, -0.2, 0]}><primitive object={object} /></group>
}

// ─── Loader ring ──────────────────────────────────────────────────────────────
function LoaderRing() {
  return (
    <div className="loader-ring">
      <div /><div /><div /><div />
    </div>
  )
}

// ─── Viewer ───────────────────────────────────────────────────────────────────
function Viewer({ modelUrl, autoRotate, bossName }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    const t = setTimeout(() => setReady(true), 80)
    return () => clearTimeout(t)
  }, [modelUrl])

  if (!modelUrl || modelUrl.trim() === '') {
    return (
      <div className="empty-viewer">
        <div className="empty-viewer-icon">⬡</div>
        <p>Aucun modèle 3D disponible</p>
        <span>Upload un GLB ou ajoute une URL R2 pour ce boss</span>
      </div>
    )
  }

  return (
    <div className={`viewer-wrapper ${ready ? 'viewer-ready' : ''}`}>
      <ViewerErrorBoundary key={modelUrl}>
        <Canvas
          className="viewer-canvas"
          camera={{ position: [0, 1.6, 5], fov: 40 }}
          shadows
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <color attach="background" args={['#050608']} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[4, 6, 4]} intensity={3} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <directionalLight position={[-4, 3, -3]} intensity={1.4} color="#8fb5ff" />
          <pointLight position={[0, 2, 5]} intensity={0.8} color="#ffddb0" />
          <Suspense fallback={null}>
            <EldenModel url={modelUrl} />
            <Environment preset="night" />
          </Suspense>
          <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}>
            <circleGeometry args={[4.5, 64]} />
            <meshStandardMaterial color="#111118" roughness={0.85} metalness={0.2} />
          </mesh>
          <OrbitControls
            enablePan enableZoom enableDamping
            dampingFactor={0.08}
            minDistance={2.5} maxDistance={10}
            target={[0, 1, 0]}
            autoRotate={autoRotate} autoRotateSpeed={0.8}
          />
        </Canvas>
      </ViewerErrorBoundary>
      {/* Vignette overlay */}
      <div className="viewer-vignette" />
      {/* Boss name watermark */}
      {bossName && <div className="viewer-boss-name">{bossName}</div>}
    </div>
  )
}

// ─── Difficulty stars (read-only or interactive) ──────────────────────────────
function DifficultyStars({ value, onChange }) {
  const labels = ['', 'Facile', 'Accessible', 'Modéré', 'Difficile', 'Cauchemar']
  return (
    <div className="diff-stars">
      {[1, 2, 3, 4, 5].map((v) => (
        <button
          key={v}
          type="button"
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

// ─── Info pane content ────────────────────────────────────────────────────────
function InfoPane({ model, onUpdateInfo }) {
  const [editMode, setEditMode] = useState(false)
  const info = ensureInfo(model)

  // Reset edit mode when model changes
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
      {/* Header */}
      <div className="info-header">
        <div className="info-header-main">
          <h2 className="info-boss-name">{info.title || model.name}</h2>
          <p className="info-boss-role">{info.role || 'Boss'}</p>
          <DifficultyStars
            value={info.difficulty || 3}
            onChange={editMode ? (v) => onUpdateInfo(model.id, { difficulty: v }) : null}
          />
        </div>
        <button
          type="button"
          className={`edit-toggle ${editMode ? 'active' : ''}`}
          onClick={() => setEditMode(v => !v)}
          title={editMode ? 'Terminer l\'édition' : 'Modifier la fiche'}
        >
          {editMode ? '✓ Fermer' : '✎ Éditer'}
        </button>
      </div>

      {/* Badges zone + niveau */}
      <div className="info-badges">
        {info.area && <span className="info-badge"><span className="badge-icon">⌖</span>{info.area}</span>}
        {info.recommendedLevel && <span className="info-badge badge-level"><span className="badge-icon">◈</span>Niv. {info.recommendedLevel}</span>}
        {info.affiliation && <span className="info-badge badge-affil"><span className="badge-icon">⚑</span>{info.affiliation}</span>}
      </div>

      {/* Sections */}
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
              {field('Tags (virgule)', 'tags', false, 1, 'shardbearer, bleed, late game')}
            </div>
          </details>
        )}
      </div>

      {/* Tags chips */}
      {tagList.length > 0 && (
        <div className="tag-list">
          {tagList.map(tag => <span key={tag} className="tag-pill">{tag}</span>)}
        </div>
      )}
    </>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [models, setModels] = useState(() => loadStoredModels())
  const [selectedId, setSelectedId] = useState(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [search, setSearch] = useState('')
  const [showControls, setShowControls] = useState(false)
  // Mobile : panel actif (viewer | info)
  const [mobilePanel, setMobilePanel] = useState('viewer')

  const selectedModel = models.find(m => m.id === selectedId) || models[0]

  // Persistance
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(models)) } catch { }
  }, [models])

  // Chargement library.json — remoteUrl/modelPath écrase TOUJOURS l'URL locale
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
            const id = entry.id || `builtin-${index}`
            const name = entry.name || 'Inconnu'
            const info = { ...DEFAULT_INFO, ...(entry.info || {}), title: entry.info?.title || name }
            let canonicalUrl = ''
            const isRemote = entry.remoteUrl && entry.remoteUrl.trim() !== '' && !entry.remoteUrl.startsWith('REMPLACE')
            if (isRemote) canonicalUrl = withCorsProxy(entry.remoteUrl)
            else if (entry.modelPath && entry.modelPath.trim() !== '')
              canonicalUrl = `${import.meta.env.BASE_URL}${entry.modelPath.replace(/^\//, '')}`
            const source = isRemote ? 'remote' : 'builtin'
            const existing = byId.get(id) || merged.find(m => m.name === name)
            if (existing) {
              existing.info = { ...ensureInfo(existing), ...info }
              if (canonicalUrl && existing.source !== 'upload') { existing.url = canonicalUrl; existing.source = source }
            } else {
              merged.push({ id, name, url: canonicalUrl, source, info })
            }
          })
          return merged
        })
      } catch { }
    }
    if (!cancelled) loadLibrary()
    return () => { cancelled = true }
  }, [])

  const addModel = useCallback((name, url, source) => {
    const safeUrl = isBlobUrl(url) ? url : withCorsProxy(url)
    setModels(current => {
      const id = `${Date.now()}-${current.length}`
      const next = [...current, { id, name, url: safeUrl, source, info: { ...DEFAULT_INFO, title: name } }]
      setSelectedId(id)
      return next
    })
  }, [])

  const updateModelInfo = useCallback((id, patch) => {
    setModels(current => current.map(m =>
      m.id === id ? { ...m, info: { ...DEFAULT_INFO, ...(m.info || {}), ...patch } } : m
    ))
  }, [])

  const handleFiles = useCallback((files) => {
    if (!files?.length) return
    Array.from(files).forEach(file => {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) return
      addModel(file.name.replace(/\.[^.]+$/, ''), URL.createObjectURL(file), 'upload')
    })
  }, [addModel])

  const handleDrop = useCallback(e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }, [handleFiles])
  const handleDragOver = useCallback(e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragging(true) }, [])
  const handleDragLeave = useCallback(e => { e.preventDefault(); setIsDragging(false) }, [])

  const handleRemoteAdd = useCallback(() => {
    const url = remoteUrl.trim()
    if (!url) return
    addModel(url.split('/').pop() || 'Remote GLB', url, 'remote')
    setRemoteUrl('')
    setShowControls(false)
  }, [addModel, remoteUrl])

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(models.map(m => ({ id: m.id, name: m.name, source: m.source, url: m.source === 'remote' ? m.url : '', info: ensureInfo(m) })), null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'elden-ring-3d-library.json' })
    a.click(); URL.revokeObjectURL(a.href)
  }, [models])

  const handleImport = useCallback(file => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (!Array.isArray(parsed)) return
        setModels(current => {
          const byName = new Map(current.map(m => [m.name, m]))
          const merged = [...current]
          parsed.forEach(entry => {
            if (!entry || typeof entry !== 'object') return
            const name = entry.name || 'Inconnu'
            const existing = byName.get(name)
            if (existing) { existing.info = { ...ensureInfo(existing), ...(entry.info || {}) } }
            else merged.push({ id: entry.id || `${Date.now()}-${merged.length}`, name, url: withCorsProxy(entry.url || ''), source: entry.source || (entry.url ? 'remote' : 'unknown'), info: { ...DEFAULT_INFO, ...(entry.info || {}), title: entry.info?.title || name } })
          })
          return [...merged]
        })
      } catch { }
    }
    reader.readAsText(file)
  }, [])

  const filteredModels = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return models
    return models.filter(m => {
      const info = ensureInfo(m)
      return (
        (info.title || m.name).toLowerCase().includes(q) ||
        (info.tags || '').toLowerCase().includes(q) ||
        (info.area || '').toLowerCase().includes(q) ||
        (info.role || '').toLowerCase().includes(q)
      )
    })
  }, [models, search])

  const handleSelectModel = (id) => {
    setSelectedId(id)
    setMobilePanel('viewer')
  }

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
          <button type="button" className={`header-btn ${autoRotate ? 'active' : ''}`} onClick={() => setAutoRotate(v => !v)} title={autoRotate ? 'Arrêter la rotation' : 'Activer la rotation'}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><path d="M4 10a6 6 0 1 0 6-6" /><polyline points="1,7 4,10 7,7" /></svg>
          </button>
          <button type="button" className="header-btn" onClick={() => setShowControls(v => !v)} title="Importer / Exporter">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><circle cx="10" cy="10" r="2" fill="currentColor" /><circle cx="10" cy="3" r="2" fill="currentColor" /><circle cx="10" cy="17" r="2" fill="currentColor" /></svg>
          </button>
        </div>
      </header>

      {/* ── Controls drawer ── */}
      {showControls && (
        <div className="controls-drawer">
          <label className="ctrl-btn">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><path d="M10 2v12M4 8l6-6 6 6" /><rect x="2" y="15" width="16" height="3" rx="1" /></svg>
            Importer un GLB
            <input type="file" accept=".glb,.gltf" onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
          </label>
          <div className="ctrl-url">
            <input type="url" placeholder="URL directe .glb (R2, Dropbox...)" value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRemoteAdd()} />
            <button type="button" onClick={handleRemoteAdd}>Ajouter</button>
          </div>
          <button type="button" className="ctrl-btn" onClick={handleExport}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><path d="M10 13V1M4 7l6 6 6-6" /><rect x="2" y="15" width="16" height="3" rx="1" /></svg>
            Exporter JSON
          </button>
          <label className="ctrl-btn">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><rect x="2" y="2" width="16" height="16" rx="2" /><path d="M6 10h8M10 6v8" /></svg>
            Importer JSON
            <input type="file" accept="application/json" onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = '' }} />
          </label>
        </div>
      )}

      {/* ── Body ── */}
      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-search">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14" className="search-icon"><circle cx="8.5" cy="8.5" r="5.5" /><line x1="13" y1="13" x2="17" y2="17" /></svg>
            <input
              type="search"
              placeholder="Rechercher un boss…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Rechercher"
            />
          </div>
          <ul className="model-list">
            {filteredModels.length === 0 && (
              <li className="model-empty">Aucun résultat pour « {search} »</li>
            )}
            {filteredModels.map(model => {
              const info = ensureInfo(model)
              const diff = info.difficulty || 0
              const hasModel = !!model.url
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    className={`model-item ${selectedModel?.id === model.id ? 'active' : ''}`}
                    onClick={() => handleSelectModel(model.id)}
                  >
                    <div className="model-item-top">
                      <span className="model-name">{info.title || model.name}</span>
                      <span className={`model-glb-dot ${hasModel ? 'has-model' : ''}`} title={hasModel ? 'Modèle 3D disponible' : 'Pas de modèle 3D'} />
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

        {/* Viewer */}
        <main
          className={`main-pane ${isDragging ? 'dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Mobile tab bar */}
          <div className="mobile-tabs">
            <button type="button" className={mobilePanel === 'viewer' ? 'active' : ''} onClick={() => setMobilePanel('viewer')}>⬡ Modèle 3D</button>
            <button type="button" className={mobilePanel === 'info' ? 'active' : ''} onClick={() => setMobilePanel('info')}>✦ Fiche boss</button>
          </div>

          <div className={`mobile-panel ${mobilePanel === 'viewer' ? 'visible' : ''}`}>
            <Viewer
              modelUrl={selectedModel?.url}
              autoRotate={autoRotate}
              bossName={selectedModel ? (ensureInfo(selectedModel).title || selectedModel.name) : ''}
            />
            {isDragging && (
              <div className="drop-overlay">
                <p>Dépose ton fichier GLB ici</p>
              </div>
            )}
          </div>

          {/* Info pane mobile (visible via tab) */}
          <div className={`mobile-panel mobile-info-panel ${mobilePanel === 'info' ? 'visible' : ''}`}>
            <InfoPane model={selectedModel} onUpdateInfo={updateModelInfo} />
          </div>
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
