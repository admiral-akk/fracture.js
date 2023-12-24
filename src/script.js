import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import GUI from 'lil-gui'
import overlayVertexShader from './shaders/overlay/vertex.glsl'
import overlayFragmentShader from './shaders/overlay/fragment.glsl'
import { gsap } from 'gsap'
import Stats from 'stats-js'

/**
 * Core objects
 */
const canvas = document.querySelector('canvas.webgl');
const renderer = new THREE.WebGLRenderer( { canvas });
renderer.setClearColor('#201919')
const scene = new THREE.Scene()
var stats = new Stats()
stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom)

/**
 * Loader Setup
 */

const loadingManager = new THREE.LoadingManager()
const textureLoader = new THREE.TextureLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
dracoLoader.setDecoderPath("./draco/gltf/");

/**
 * Load texture
 */
const texture = textureLoader.load('https://source.unsplash.com/random/100x100?sig=1')

/**
 * Window size
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix() 
    
    // Render
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})


if (window.screen && window.screen.orientation) {
    window.screen.orientation.onchange = () => {
        sizes.width = window.innerWidth
        sizes.height = window.innerHeight
    
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix() 
        
        // Render
        renderer.setSize(sizes.width, sizes.height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    }
}

window.addEventListener('dblclick', () => {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement

    if (fullscreenElement) {
        document.exitFullscreen();
    } else {
        canvas.requestFullscreen()
    }
})

/**
 * Setup camera
 */
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height);
camera.position.x = 1;
camera.position.y = 1;
camera.position.z = 1;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement)
controls.enabled = true;

/**
 * Debug
 */

const debugObject = {timeSpeed: 1.0}
const gui = new GUI();
gui.add(debugObject, 'timeSpeed').min(0).max(3).step(0.1);


/**
 * Loading overlay
 */
const overlayGeometry = new THREE.PlaneGeometry(2, 2,1,1);
const overlayMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: overlayVertexShader,
    fragmentShader: overlayFragmentShader,
    uniforms: {
        uMinY: {value: 0.0},
        uWidthY: {value: 0.005},
        uMaxX: {value: 0.0},
    }
})
const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial)
scene.add(overlay)

/**
 * Loading Animation
 */
let progressRatio = 0.0
let timeTracker = {enabled: false, elapsedTime: 0.0}
loadingManager.onProgress = (_, itemsLoaded, itemsTotal) =>
{
    progressRatio = Math.max(itemsLoaded / itemsTotal, progressRatio)
    gsap.to(overlayMaterial.uniforms.uMaxX, {duration: 1., value: progressRatio})
    if (progressRatio == 1.) {
        const timeline = gsap.timeline();
        timeline.to(overlayMaterial.uniforms.uWidthY, {duration: 0.2, delay:1.0, value: 0.01, ease:'power1.inOut'})
        timeline.to(overlayMaterial.uniforms.uWidthY, {duration: 0.2, value: 0.0, ease: 'power1.in'})
        timeline.set(timeTracker, {enabled: true})
        timeline.to(overlayMaterial.uniforms.uMinY, {duration: 0.6, value: 0.5, ease: 'power1.in'})
    }
 };


/**
 *  Box
 */
const boxG = new THREE.BoxGeometry()
const boxM = new THREE.MeshBasicMaterial({map: texture})
const boxMesh = new THREE.Mesh(boxG, boxM)
scene.add(boxMesh)

const rotateBox = (time) => {
    boxMesh.setRotationFromEuler(new THREE.Euler(0, time, 0)) 
}

/**
 * Animation
 */
const clock = new THREE.Clock()
const tick = () =>
{
    stats.begin()
    if (controls.enabled){
        timeTracker.elapsedTime =  timeTracker.elapsedTime + debugObject.timeSpeed * clock.getDelta();
    }

    // update controls
    controls.update()

    // Render scene
    rotateBox(timeTracker.elapsedTime)
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
    stats.end()
}

tick()

