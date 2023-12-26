import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import GUI from 'lil-gui'
import overlayVertexShader from './shaders/overlay/vertex.glsl'
import overlayFragmentShader from './shaders/overlay/fragment.glsl'
import crackVertexShader from './shaders/crack/vertex.glsl'
import crackFragmentShader from './shaders/crack/fragment.glsl'
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
 * DCEL: https://en.wikipedia.org/wiki/Doubly_connected_edge_list
 */
class Plane {
    constructor(position, normal) {
        this.position = position;
        this.normal = normal;
    }
}

class HalfEdge {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        this.prev = null;
        this.next = null;
        this.twin = null;
    }
}

class DcelMesh {
    getEdge(start, end) {
        let index = start + this.vertices.length * end;
        if (!this.edges.has(index)) {
            return null;
        }
        return this.edges.get(index)
    }

    addEdge(edge) {
        let index = edge.start + this.vertices.length * edge.end;
        this.edges.set(index, edge);
        let twin = this.getEdge(edge.end, edge.start);
        if (twin) {
            twin.twin = edge;
            edge.twin = twin;
        }
    }

    constructor(vertices, faces) {
        this.vertices = vertices;
        this.edges = new Map();
        for (let j = 0; j < faces.length; j++) {
            let face = faces[j]
            for (let i = 0; i < face.length; i++) {
                let start = face[i];
                let end = face[(i + 1) % face.length];
                this.addEdge(new HalfEdge(start, end));
            }
            for (let i = 0; i < face.length; i++) {
                let curr = face[i];
                let next1 = face[(i + 1) % face.length];
                let next2 = face[(i +2) % face.length];
                let prev = this.getEdge(face[i], face[(i + 1) % face.length]);
                let next = this.getEdge(face[(i + 1) % face.length],face[(i + 2) % face.length]);
                prev.next = next;
                next.prev = prev;
            }
        }
    }

    cut(plane) {

    }

    toVertices() {
        const traversedEdges = new Map();
        var indices = [];
        for (let edge of this.edges.values()) {
            let index = edge.start + this.vertices.length * edge.end;
            if (traversedEdges.has(index)) {
                continue;
            }
            traversedEdges.set(index, true);
            var next = edge.next;
            while (next.end !== edge.start) {
                indices.push(edge.start,next.start,next.end);
                let index = next.start + this.vertices.length * next.end;
                traversedEdges.set(index, true);
                next = next.next;
            }
        }

        return [new Float32Array(this.vertices), indices];
    }
}

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
controls.enableRotate = false;


/**
 * Mouse tracking
 */
const mouse = {
    start: null,
    end: null
}

const mousePos = (event) => {
    return new THREE.Vector2(
        ( event.clientX / window.innerWidth ) * 2 - 1,
        - ( event.clientY / window.innerHeight ) * 2 + 1
    )
}
window.addEventListener('pointermove', (event) => {
    if (mouse.start) {
        mouse.end = mousePos(event);
    }
} );
window.addEventListener('pointerdown', (event) => {
    mouse.start = mousePos(event);
    mouse.end = null;
  });
window.addEventListener('pointerup', (event) => {
    mouse.start = null;
    mouse.end = null;
});

/**
 * Debug
 */

const debugObject = {timeSpeed: 1.0, color: 2., stepVal: 0.}
const gui = new GUI();
gui.add(debugObject, 'timeSpeed').min(0).max(3).step(0.1);
gui.add(debugObject, 'color').min(0).max(4).step(1.);
gui.add(debugObject, 'stepVal').min(-2).max(2).step(0.01);


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
 * Plane cut
 */

const raycaster = new THREE.Raycaster(camera.position);
raycaster.layers.set(1);
const cut = {
    startHit: null,
    startNormal: null,
    endHit: null
}
const updateCut = () => {
    if (mouse.start) {
        raycaster.setFromCamera( mouse.start, camera );
        const intersects = raycaster.intersectObjects( scene.children );
        if (intersects.length > 0) {
            cut.startHit = intersects[0].point;
            cut.startNormal = intersects[0].normal;
        }
    }
    
    if (mouse.end) {
        raycaster.setFromCamera( mouse.end, camera );
        const intersects = raycaster.intersectObjects( scene.children );
        if (intersects.length > 0) {
            cut.endHit = intersects[0].point;
        }
    }
}

/**
 *  Box
 */

const boxGeo = new THREE.BoxGeometry();
function splitToNChunks(array, len) {
    let result = [];
    while(array.length > 0) {
        result.push(array.splice(0, 3));
    }
    return result;
}
var vertices = Array.from(boxGeo.attributes.position.array);
var indices = splitToNChunks(Array.from(boxGeo.index.array), 3);
var dcelMesh = new DcelMesh(vertices, indices);

let [vertices2, indices2] = dcelMesh.toVertices();

console.log(vertices2);
console.log(indices2);

const boxG = new THREE.BufferGeometry();
boxG.setIndex(indices2)
boxG.setAttribute( 'position', new THREE.BufferAttribute(vertices2, 3))
boxG.computeBoundingBox();
const boxM = new THREE.ShaderMaterial({
    vertexShader: crackVertexShader, 
    fragmentShader: crackFragmentShader,
    uniforms: {
        mIsDragging: {value: false},
        mStart: {value: new THREE.Vector2()},
        mEnd: {value: new THREE.Vector2()},
        startHit: {value: new THREE.Vector2()},
        startNormal: {value: new THREE.Vector2()},
        endHit: {value: new THREE.Vector2()},
        c: {value: debugObject.color},
        stepVal : {value: debugObject.stepVal}
        
    }
})

const boxMesh = new THREE.Mesh(boxG, boxM)
boxMesh.layers.enable(1);
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
    if (timeTracker.enabled){
        timeTracker.elapsedTime =  timeTracker.elapsedTime + debugObject.timeSpeed * clock.getDelta();
    }

    // update controls
    controls.update()
    
    // update box
    rotateBox(timeTracker.elapsedTime)
    boxM.uniforms.mIsDragging.value = mouse.end !== null;
    if (boxM.uniforms.mIsDragging.value) {
        boxM.uniforms.mStart.value = mouse.start;
        boxM.uniforms.mEnd.value = mouse.end;
    }
    updateCut();
    if (cut.startHit) {
        boxM.uniforms.startHit.value = cut.startHit;
    }
    if (cut.endHit) {
        boxM.uniforms.endHit.value = cut.endHit;
    }
    if (cut.startNormal) {
        boxM.uniforms.startNormal.value = cut.startNormal;
    }
    boxM.uniforms.c.value = debugObject.color;
    boxM.uniforms.stepVal.value = debugObject.stepVal;


    // Render scene
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
    stats.end()
}

tick()

