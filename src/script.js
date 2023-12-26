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
        this.normal = normal.normalize();
    }

    intersection(start,end) {
        // if it doesn't intersect, return
        if (!this.cuts(start,end)) {
            return null;
        }

        const delta = new THREE.Vector3();
        delta.subVectors(end, start);
        delta.normalize();
        const planeDelta = new THREE.Vector3();
        planeDelta.subVectors(this.position,  start);
        const len = Math.abs(planeDelta.dot(this.normal));
        delta.multiplyScalar(len);
        delta.add(this.position); 
        return delta;
    }
    cuts(start, end) {
        let startDist = start.sub(this.position).dot(this.normal);
        let endDist = end.sub(this.position).dot(this.normal);
        return endDist * startDist < 0.0;
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

    setNext(next) {
        this.next = next;
        next.prev = this;
    }
}

class DcelMesh {
    getVertex(index) {
        return this.vertices[index].clone();
    }

    index(start, end) {
        return  start.toString() + "+" + end.toString();
    }

    getEdge(start, end) {
        let index = this.index(start ,end);
        return this.edges.get(index)
    }

    addNormalizedVertex(vertex) {
    let existingIndex = this.vertices.findIndex(v => v.equals(vertex))
    if (existingIndex >= 0 ) {
        return existingIndex;
    } else {
        return this.addVertex(vertex);
    }
    }

    addVertex(vertex) {
        this.vertices.push(vertex);
        return this.vertices.length - 1;
    }

    addEdge(edge) {
        let index = this.index(edge.start, edge.end);
        this.edges.set(index, edge);
        let twin = this.getEdge(edge.end, edge.start);
        if (twin) {
            twin.twin = edge;
            edge.twin = twin;
        }
        return edge
    }

    deleteEdge(edge) {
        let index = this.index(edge.start, edge.end);
        this.edges.delete(index);
        let twin = this.getEdge(edge.end, edge.start);
        if (twin) {
            twin.twin = null;
        }
    }

    constructor(vertices, faces) {
        this.vertices = [];
        const indexRemapping = new Map();
        for (let i = 0; i < vertices.length; i += 3) {
            let vertex = new THREE.Vector3().fromArray(vertices, i)
            let index = this.addNormalizedVertex(vertex)
            indexRemapping.set(i / 3, index)
        }
        const remappedFaces = faces.map(face => (face.map(i => indexRemapping.get(i))));
        this.edges = new Map();
        for (let face of remappedFaces) {
            this.addFace(face)
        }
    }

    // tries to break the mesh into seperate pieces
    break() {
        const clusters = []
        const visitedEdges = []
        for (let edge of this.edges.values()) {
            const cluster = []
            const queue = [[null, edge]]
            while (queue.length > 0) {
                const [prev, next] = queue.pop();
                if (visitedEdges.includes(next)) {
                    continue;
                }
                visitedEdges.push(next);
                cluster.push(next);
                queue.push([next, next.next], [next, next.prev], [next, next.twin]);
            }
            if (cluster.length > 0) {
                clusters.push(cluster)
            }
        }
        console.log(clusters)
    }

    chainEdges(edges) {
        edges.forEach((e, i) => {
            if (i < edges.length - 1){
            e.setNext(edges[i+1]);}
        })
    }

    addFace(indices) {
        let edges = indices.map((v, i) => new HalfEdge(v, indices[(i+1) % indices.length]));
        edges.forEach(e => this.addEdge(e))
        edges.push(edges[0])

        this.chainEdges(edges);
    }

    cut(plane) {
        // Find a cut edge:
        for (let edge of this.edges.values()) {
            if (!plane.cuts(this.getVertex(edge.start),this.getVertex(edge.end))) {
                continue;
            }
            var cutEdges = [edge];
            var next = edge.next;
            // edge is cut. Find edges that are going to be cut, in order.
            while (true) {
                while (!plane.cuts(this.getVertex(next.start),this.getVertex(next.end))) {
                    next = next.next;
                }
                cutEdges.push(next);
                next = next.twin;
                if (next === edge) {
                    break;
                }
                cutEdges.push(next);
                next = next.next;
            }

            // each pair of edges belongs to the same face. 
            // go through each pair, split them, add two new half edges, and then store them
            var leftPoints = []
            var rightPoints = []
            for (let i = 0; i < cutEdges.length; i += 2) {
                const vertex = plane.intersection(this.getVertex(cutEdges[i].start),
                this.getVertex(cutEdges[i].end));
                leftPoints.push(this.addVertex(vertex))
                rightPoints.push(this.addVertex(vertex))
            }
            
            for (let i = 0; i < cutEdges.length; i += 2) {
                let first = cutEdges[i];
                let second = cutEdges[(i+1) % cutEdges.length];
                const firstLeftIndex = leftPoints[i / 2]
                const firstRightIndex = rightPoints[i / 2]
                const secondLeftIndex = leftPoints[(i / 2+1) % leftPoints.length]
                const secondRightIndex = rightPoints[(i / 2+1) % rightPoints.length]

                const leftStart = this.addEdge(new HalfEdge(first.start, firstLeftIndex))
                const leftEdge = this.addEdge(new HalfEdge(firstLeftIndex, secondLeftIndex))
                const leftEnd = this.addEdge(new HalfEdge(secondLeftIndex, second.end))

                const rightStart = this.addEdge(new HalfEdge(second.start, secondRightIndex))
                const rightEdge = this.addEdge(new HalfEdge(secondRightIndex, firstRightIndex))
                const rightEnd = this.addEdge(new HalfEdge(firstRightIndex, first.end))

                if (second.prev === first) {
                    this.chainEdges([rightStart, rightEdge, rightEnd, rightStart])

                } else {
                    this.chainEdges([second.prev, rightStart, rightEdge, rightEnd, first.next])
                }

                if (first.prev === second) {
                    this.chainEdges([ leftStart, leftEdge, leftEnd, leftStart])

                } else {
                    this.chainEdges([first.prev, leftStart, leftEdge, leftEnd, second.next])
                }

                this.deleteEdge(first);
                this.deleteEdge(second);
            }

            this.addFace(leftPoints.reverse())
            this.addFace(rightPoints)
            break;
        }
        console.log(this.edges)
        console.log(Array.from(this.edges.values()).filter(e => e.prev === null))
        console.log(Array.from(this.edges.values()).filter(e => e.next === null))
        console.log(Array.from(this.edges.values()).filter(e => e.twin === null))
        this.break()
    }

    toVertices() {
        let [vertices, indices] = this.toVerticesIndices();
        let vertexArray = new Float32Array(indices.length * 3);
        indices.forEach((vertexIndex, index) => {
            vertexArray[3*index] = vertices[3*vertexIndex]
            vertexArray[3*index+1] = vertices[3*vertexIndex+1]
            vertexArray[3*index+2] = vertices[3*vertexIndex+2]
        })
        return vertexArray;
    }

    toVerticesIndices() {
        const traversedEdges = new Map();
        var indices = [];
        for (let edge of this.edges.values()) {
            let index = this.index(edge.start, edge.end);
            if (traversedEdges.has(index)) {
                continue;
            }
            traversedEdges.set(index, true);
            var next = edge.next;
            while (next.end !== edge.start) {
                indices.push(edge.start,next.start,next.end);
                let index = this.index(next.start, next.end);
                traversedEdges.set(index, true);
                next = next.next;
            }
        }
        let vertexArray = new Float32Array(this.vertices.length * 3);
        this.vertices.forEach((v, i) => v.toArray(vertexArray, 3*i));
        return [vertexArray, indices];
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
    end: null,
    justReleased: false
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
    mouse.justReleased=  true;
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

let vertices2 = dcelMesh.toVertices();

const boxG = new THREE.BufferGeometry();
boxG.setAttribute( 'position', new THREE.BufferAttribute(vertices2, 3))
boxG.computeVertexNormals()
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

    if (mouse.justReleased) {
        var diff = new THREE.Vector3();
        diff.subVectors(cut.startHit, cut.endHit);
        var planeNormal = new THREE.Vector3();
        planeNormal.crossVectors(cut.startNormal, diff).normalize();
        let plane = new Plane(cut.startHit, planeNormal);
        dcelMesh.cut(plane)
        mouse.justReleased= false;
    }
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

