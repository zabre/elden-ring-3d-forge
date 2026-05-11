import React, { Suspense, useCallback, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

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

    return {
      object: root,
      scale: 3 / longest,
    }
  }, [gltf.scene])

  return (
    <group scale={scale} position={[0, -0.2, 0]}>
      <primitive object={object} />
    </group>
  )
}

function Viewer({ modelUrl }) {
  if (!modelUrl) {
    return (
      <div className="empty-viewer">
        <p>Importe un GLB Elden Ring pour commencer.</p>
      </div>
    )
  }

  return (
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

      <Suspense fallback={null}>
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
      />
    </Canvas>
  )
}

const initialBosses = []

function App() {
  const [models, setModels] = useState(initialBosses)
  const [selectedId, setSelectedId] = useState(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const selectedModel = models.find((m) => m.id === selectedId) || models[0]

  const addModel = useCallback((name, url, source) => {
    setModels((current) => {
      const id = `${Date.now()}-${current.length}`
      const next = [...current, { id, name, url, source }]
      if (!selectedId) setSelectedId(id)
      return next
    })
  }, [selectedId])

  const handleFiles = useCallback((files) => {
    if (!files?.length) return

    Array.from(files).forEach((file) => {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) return
      const url = URL.createObjectURL(file)
      addModel(file.name.replace(/\.[^.]+$/, ''), url, 'upload')
    })
  }, [addModel])

  const handleDrop = useCallback((event) => {
    event.preventDefault()
    setIsDragging(false)
    handleFiles(event.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((event) => {
    event.preventDefault()
    setIsDragging(false)
  }, [])

  const handleRemoteAdd = useCallback(() => {
    const url = remoteUrl.trim()
    if (!url) return
    addModel(url.split('/').slice(-1)[0] || 'Remote GLB', url, 'remote')
    setRemoteUrl('')
  }, [addModel, remoteUrl])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Elden Ring 3D Forge</h1>
          <p>Visualise et explore tes modèles 3D de personnages et boss Elden Ring.</p>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <h2>Modèles</h2>
          {models.length === 0 && (
            <p className="sidebar-empty">
              Aucun modèle chargé.
              <br />
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
                  <span className="model-name">{model.name}</span>
                  <span className="model-source">{model.source === 'remote' ? 'URL' : 'Upload'}</span>
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
            <Viewer modelUrl={selectedModel?.url} />
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
                onChange={(event) => {
                  handleFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>

            <div className="remote-input">
              <input
                type="url"
                placeholder="Colle une URL de modèle GLB accessible en ligne"
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
              />
              <button type="button" onClick={handleRemoteAdd}>
                Ajouter depuis l'URL
              </button>
            </div>
          </div>
        </main>
      </div>

      <footer className="app-footer">
        <span>Projet basé sur React, Three.js et React Three Fiber.</span>
        <span>Les modèles Elden Ring restent sous ta responsabilité (droits, hébergement, etc.).</span>
      </footer>
    </div>
  )
}

export default App
