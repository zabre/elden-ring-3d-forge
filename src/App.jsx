import React, { Component, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
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
      if (isBlobUrl(model.url) || isBuiltinPath(model.url)) {
        return { ...model, url: '' }
      }
      if (model.url) {
        return { ...model, url: withCorsProxy(model.url) }
      }
      return model
    })
  } catch {
    return []
  }
}

const DEFAULT_INFO = {
  title: '',
  role: '',
  area: '',
  affiliation: '',
  difficulty: 3,
  recommendedLevel: '',
  fightStyle: '',
  keyMoves: '',
  strategyNotes: '',
  tags: '',
}

function ensureInfo(model) {
  if (!model) return DEFAULT_INFO
  return { ...DEFAULT_INFO, ...(model.info || {}) }
}

class ViewerErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Erreur inconnue' }
  }

  componentDidCatch(error, info) {
    console.warn('[Viewer] Erreur capturée :', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="viewer-error">
          <p>⚠️ Impossible de charger ce modèle.</p>
          <p className="viewer-error-detail">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function EldenModel({ url }) {
  const gltf = useGLTF(url)

  const { object, scale } = useMemo(() => {
    const root = gltf.scene.clone(true)

    root.traverse((node) => {
      if (!node.isMesh) return
      node.castShadow = true
      node.receiveShadow = true
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material]
        materials.forEach((material) => {
          material.side = THREE.DoubleSide
          material.envMapIntensity = Math.max(material.envMapIntensity || 0, 1.1)
          material.needsUpdate = true
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

  return (
    <group scale={scale} position={[0, -0.2, 0]}>
      <primitive object={object} />
    </group>
  )
}

function Viewer({ modelUrl, autoRotate }) {
  if (!modelUrl || modelUrl.trim() === '') {
    return (
      <div className="empty-viewer">
        <p>Aucun modèle disponible. Importe un GLB ou ajoute une URL.</p>
      </div>
    )
  }

  return (
    <ViewerErrorBoundary key={modelUrl}>
      <Canvas
        className="viewer-canvas"
        camera={{ position: [0, 1.6, 5], fov: 40 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#050608']} />
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[4, 6, 4]}
          intensity={3}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-4, 3, -3]} intensity={1.4} color="#8fb5ff" />
        <pointLight position={[0, 2, 5]} intensity={0.8} color="#ffddb0" />

        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>
          }
        >
          <EldenModel url={modelUrl} />
          <Environment preset="night" />
        </Suspense>

        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -1.1, 0]}
        >
          <circleGeometry args={[4.5, 64]} />
          <meshStandardMaterial color="#111118" roughness={0.85} metalness={0.2} />
        </mesh>

        <OrbitControls
          enablePan
          enableZoom
          enableDamping
          dampingFactor={0.08}
          minDistance={2.5}
          maxDistance={10}
          target={[0, 1, 0]}
          autoRotate={autoRotate}
          autoRotateSpeed={0.8}
        />
      </Canvas>
    </ViewerErrorBoundary>
  )
}

function App() {
  const [models, setModels] = useState(() => loadStoredModels())
  const [selectedId, setSelectedId] = useState(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)

  const selectedModel = models.find((m) => m.id === selectedId) || models[0]
  const selectedInfo = selectedModel ? ensureInfo(selectedModel) : null

  // Persistance locale
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(models))
    } catch { /* ignore */ }
  }, [models])

  // Chargement de la bibliothèque JSON au démarrage
  // L'URL définie dans library.json (remoteUrl ou modelPath) écrase TOUJOURS
  // l'URL stockée localement pour les entrées builtin/remote, afin que
  // mettre à jour library.json suffise sans vider le localStorage.
  useEffect(() => {
    let cancelled = false

    async function loadLibrary() {
      try {
        const response = await fetch(LIBRARY_URL)
        if (!response.ok) return
        const data = await response.json()
        if (!Array.isArray(data)) return

        setModels((current) => {
          const byId = new Map(current.map((m) => [m.id, m]))
          const merged = [...current]

          data.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') return
            const id = entry.id || `builtin-${index}`
            const name = entry.name || 'Inconnu'
            const info = { ...DEFAULT_INFO, ...(entry.info || {}), title: entry.info?.title || name }

            // Calcule l'URL canonique depuis library.json
            let canonicalUrl = ''
            const isRemote = entry.remoteUrl && entry.remoteUrl.trim() !== '' && !entry.remoteUrl.startsWith('REMPLACE')
            if (isRemote) {
              canonicalUrl = withCorsProxy(entry.remoteUrl)
            } else if (entry.modelPath && entry.modelPath.trim() !== '') {
              canonicalUrl = `${import.meta.env.BASE_URL}${entry.modelPath.replace(/^\//, '')}`
            }

            const source = isRemote ? 'remote' : 'builtin'
            const existing = byId.get(id) || merged.find((m) => m.name === name)

            if (existing) {
              // Toujours mettre à jour la fiche info
              existing.info = { ...ensureInfo(existing), ...info }
              // Écraser l'URL si library.json en fournit une valide
              // (sauf si l'utilisateur a uploadé un fichier local cette session)
              if (canonicalUrl && existing.source !== 'upload') {
                existing.url = canonicalUrl
                existing.source = source
              }
            } else {
              merged.push({ id, name, url: canonicalUrl, source, info })
            }
          })

          return merged
        })
      } catch { /* pas grave si le JSON n'existe pas encore */ }
    }

    if (!cancelled) loadLibrary()
    return () => { cancelled = true }
  }, [])

  const addModel = useCallback((name, url, source) => {
    const safeUrl = isBlobUrl(url) ? url : withCorsProxy(url)
    setModels((current) => {
      const id = `${Date.now()}-${current.length}`
      const base = { id, name, url: safeUrl, source, info: { ...DEFAULT_INFO, title: name } }
      const next = [...current, base]
      if (!selectedId) setSelectedId(id)
      return next
    })
  }, [selectedId])

  const updateModelInfo = useCallback((id, patch) => {
    setModels((current) =>
      current.map((model) =>
        model.id === id
          ? { ...model, info: { ...DEFAULT_INFO, ...(model.info || {}), ...patch } }
          : model,
      ),
    )
  }, [])

  const handleFiles = useCallback((files) => {
    if (!files?.length) return
    Array.from(files).forEach((file) => {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) return
      const url = URL.createObjectURL(file)
      addModel(file.name.replace(/\.[^.]+$/, ''), url, 'upload')
    })
  }, [addModel])

  const handleDrop = useCallback((e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }, [handleFiles])
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false) }, [])

  const handleRemoteAdd = useCallback(() => {
    const url = remoteUrl.trim()
    if (!url) return
    const nameFromUrl = url.split('/').pop() || 'Remote GLB'
    addModel(nameFromUrl, url, 'remote')
    setRemoteUrl('')
  }, [addModel, remoteUrl])

  const handleExportLibrary = useCallback(() => {
    const payload = models.map((model) => ({
      id: model.id,
      name: model.name,
      source: model.source,
      url: model.source === 'remote' ? model.url : '',
      info: ensureInfo(model),
    }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'elden-ring-3d-library.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [models])

  const handleImportLibrary = useCallback((file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (!Array.isArray(parsed)) return
        setModels((current) => {
          const byName = new Map(current.map((m) => [m.name, m]))
          const merged = [...current]
          parsed.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return
            const name = entry.name || 'Inconnu'
            const existing = byName.get(name)
            if (existing) {
              existing.info = { ...ensureInfo(existing), ...(entry.info || {}) }
            } else {
              merged.push({
                id: entry.id || `${Date.now()}-${merged.length}`,
                name,
                url: withCorsProxy(entry.url || ''),
                source: entry.source || (entry.url ? 'remote' : 'unknown'),
                info: { ...DEFAULT_INFO, ...(entry.info || {}), title: entry.info?.title || name },
              })
            }
          })
          return [...merged]
        })
      } catch { /* ignore */ }
    }
    reader.readAsText(file)
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Elden Ring 3D Forge</h1>
          <p>
            Visualise et explore les modèles 3D de personnages et boss Elden Ring.
            Enrichis la fiche pédagogique pour aider toute la communauté.
          </p>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <h2>Modèles</h2>
          {models.length === 0 && (
            <p className="sidebar-empty">
              Aucun modèle chargé.<br />
              Commence par déposer un fichier GLB dans la zone centrale.
            </p>
          )}
          <ul className="model-list">
            {models.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  className={selectedModel?.id === model.id ? 'model-item active' : 'model-item'}
                  onClick={() => setSelectedId(model.id)}
                >
                  <span className="model-name">{model.info?.title || model.name}</span>
                  <span className="model-source">
                    {model.source === 'remote' ? 'URL'
                      : model.source === 'builtin' ? 'Bibliothèque'
                      : 'Upload'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="main-pane">
          <div
            className={isDragging ? 'drop-zone dragging' : 'drop-zone'}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Viewer modelUrl={selectedModel?.url} autoRotate={autoRotate} />
            <div className="drop-zone-overlay">
              <p>Glisse-dépose ici un fichier .glb / .gltf Elden Ring</p>
              <p className="hint">ou utilise les boutons ci-dessous pour importer.</p>
            </div>
          </div>

          <div className="controls-bar">
            <label className="file-input">
              <span>Importer un GLB</span>
              <input
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
              />
            </label>

            <div className="remote-input">
              <input
                type="url"
                placeholder="URL directe vers un fichier .glb (Drive, Dropbox, R2...)"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
              />
              <button type="button" onClick={handleRemoteAdd}>
                Ajouter depuis l'URL
              </button>
            </div>

            <div className="library-actions">
              <button type="button" onClick={handleExportLibrary}>
                Exporter la bibliothèque
              </button>
              <label className="import-label">
                Importer
                <input
                  type="file"
                  accept="application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImportLibrary(file)
                    e.target.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                className="rotate-toggle"
                onClick={() => setAutoRotate((prev) => !prev)}
              >
                {autoRotate ? 'Arrêter la rotation' : 'Activer la rotation'}
              </button>
            </div>
          </div>
        </main>

        <aside className="info-pane">
          {!selectedModel && (
            <div className="info-empty">
              <p>Sélectionne ou importe un modèle pour éditer sa fiche.</p>
            </div>
          )}
          {selectedModel && selectedInfo && (
            <>
              <header className="info-header">
                <div>
                  <h2>{selectedInfo.title || selectedModel.name}</h2>
                  <p>{selectedInfo.role || 'Rôle / type (boss, PNJ, invocateur...)'}</p>
                </div>
                <div className="difficulty">
                  <span>Diff.</span>
                  <div>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={value <= (selectedInfo.difficulty || 3) ? 'star active' : 'star'}
                        onClick={() => updateModelInfo(selectedModel.id, { difficulty: value })}
                        aria-label={`Difficulté ${value}/5`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
              </header>

              <section className="info-section">
                <h3>Résumé & zone</h3>
                <div className="info-field">
                  <label>Nom / titre affiché</label>
                  <input type="text" value={selectedInfo.title}
                    onChange={(e) => updateModelInfo(selectedModel.id, { title: e.target.value })} />
                </div>
                <div className="info-field">
                  <label>Rôle (boss principal, shardbearer, PNJ, esprit...)</label>
                  <input type="text" value={selectedInfo.role}
                    onChange={(e) => updateModelInfo(selectedModel.id, { role: e.target.value })} />
                </div>
                <div className="info-field inline">
                  <div>
                    <label>Zone / région</label>
                    <input type="text" value={selectedInfo.area}
                      onChange={(e) => updateModelInfo(selectedModel.id, { area: e.target.value })} />
                  </div>
                  <div>
                    <label>Niveau recommandé</label>
                    <input type="text" value={selectedInfo.recommendedLevel}
                      onChange={(e) => updateModelInfo(selectedModel.id, { recommendedLevel: e.target.value })}
                      placeholder="ex : 120+" />
                  </div>
                </div>
              </section>

              <section className="info-section">
                <h3>Style de combat</h3>
                <div className="info-field">
                  <label>Style de combat (agressif, distance, magie, status...)</label>
                  <textarea rows={2} value={selectedInfo.fightStyle}
                    onChange={(e) => updateModelInfo(selectedModel.id, { fightStyle: e.target.value })} />
                </div>
                <div className="info-field">
                  <label>Attaques clés / patterns</label>
                  <textarea rows={3} value={selectedInfo.keyMoves}
                    onChange={(e) => updateModelInfo(selectedModel.id, { keyMoves: e.target.value })}
                    placeholder="Liste les attaques à connaître, les phases, les enchaînements dangereux..." />
                </div>
              </section>

              <section className="info-section">
                <h3>Tips & builds</h3>
                <div className="info-field">
                  <label>Stratégies recommandées</label>
                  <textarea rows={3} value={selectedInfo.strategyNotes}
                    onChange={(e) => updateModelInfo(selectedModel.id, { strategyNotes: e.target.value })}
                    placeholder="Conseils de positionnement, invocs utiles, objets clefs, fenêtres pour punir..." />
                </div>
                <div className="info-field">
                  <label>Tags (séparés par des virgules)</label>
                  <input type="text" value={selectedInfo.tags}
                    onChange={(e) => updateModelInfo(selectedModel.id, { tags: e.target.value })}
                    placeholder="ex : shardbearer, saignement, late game" />
                </div>
                {(() => {
                  const tagList = (selectedInfo.tags || '')
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                  return tagList.length > 0 ? (
                    <div className="tag-list">
                      {tagList.map((tag) => (
                        <span key={tag} className="tag-pill">{tag}</span>
                      ))}
                    </div>
                  ) : null
                })()}
              </section>
            </>
          )}
        </aside>
      </div>

      <footer className="app-footer">
        <span>Projet basé sur React, Three.js et React Three Fiber.</span>
        <span>
          Les modèles Elden Ring restent sous ta responsabilité (droits, hébergement, etc.).
          Les fiches sont stockées dans ton navigateur et exportables en JSON.
        </span>
      </footer>
    </div>
  )
}

export default App
