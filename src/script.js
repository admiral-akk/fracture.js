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
        if (!this.cuts(start.clone(),end.clone())) {
            return null;
        }

        const p0 = this.position.clone();
        const l0 = start.clone();
        const l = end.clone().sub(start).normalize();
        const p0_l0 = p0.clone().sub(l0);
        const num = p0_l0.dot(this.normal);
        const denum = l.dot(this.normal)
        return l0.add(l.multiplyScalar(num / denum));
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
        if (this.next !== null && this.next !== next) {
            this.next.prev = null;
        }
        this.next = next;
        if (next.prev !== null && next.prev !== this) {
            next.prev.next = null;
        }
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
        if (edge.prev && edge.prev.next === edge) {
            console.log("NEVER")
            edge.prev.next = null;
        } 
        if (edge.next && edge.next.prev === edge) {
            console.log("NEVER")
            edge.next.prev = null;
        }
        this.edges.delete(index);
        let twin = this.getEdge(edge.end, edge.start);
        if (twin) {
            twin.twin = null;
        }
    }

    constructor(facesVertices, offset = new THREE.Vector3(), isNormalized = false) {
        this.vertices = [];
        this.offset = offset;
        this.edges = new Map();

        for (const face of facesVertices) {
            const vIndices = []
            for (const vertex of face) {
                let index = isNormalized ? this.addVertex(vertex) : this.addNormalizedVertex(vertex)
                vIndices.push(index);
            }
            this.addFace(vIndices)
        }
        this.validate()
    }

    validate() {
        console.log("Missing next:",Array.from(this.edges.values()).filter(e => e.next === null));
        console.log("Missing prev:",Array.from(this.edges.values()).filter(e => e.prev === null));
        console.log("Missing twin:",Array.from(this.edges.values()).filter(e => e.twin === null));
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
                queue.push([prev, next.next], [prev, next.twin]);
            }
            if (cluster.length > 0) {
                clusters.push(cluster)
            }
        }
        
        var newMeshes = []

        for (let cluster of clusters) {
            const visitedEdges = []
            const faces = []
            for (let edge of cluster) {
                if (visitedEdges.includes(edge)) {
                    continue;
                }
                visitedEdges.push(edge);
                var next = edge.next;
                const face = [edge.start]
                var i = 0;
                while (next !== edge) {
                    visitedEdges.push(next);
                    face.push(next.start);
                    next = next.next;
                    i++;
                    if (i > 100) {
                        return;
                    }
                }
                faces.push(face)
            }
            let vertexArray = new Float32Array(this.vertices.length * 3);
            this.vertices.forEach((v, i) => v.toArray(vertexArray, 3*i));
            facesVertices = Array.from(faces.map(face => {
               return  Array.from(face.map(vIndex => this.vertices[vIndex].clone()))
            }));
            newMeshes.push(new DcelMesh(facesVertices,false));
        }

        return newMeshes;
    }

    chainEdges(edges) {
        edges.forEach((e, i) => {
            if (i < edges.length - 1) {
                e.setNext(edges[i+1]);
            }
        })
    }

    addFace(indices) {
        let edges = indices.map((v, i) => new HalfEdge(v, indices[(i+1) % indices.length]));
        edges.forEach(e => this.addEdge(e))
        edges.push(edges[0])

        this.chainEdges(edges);
    }

    cut(plane) {
        plane.position = plane.position.clone().sub(this.offset)
        console.log(Array.from(this.edges.values()).filter(v => v.twin === null));
        console.log(Array.from(this.edges.values()).filter(v => v.next === null));
        console.log(Array.from(this.edges.values()).filter(v => v.prev === null));
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

                const firstLeftIndex = leftPoints[(i / 2) % leftPoints.length]
                const secondLeftIndex = leftPoints[(i / 2 + 1) % leftPoints.length]

                const leftStart = this.addEdge(new HalfEdge(first.start, firstLeftIndex))
                const leftEdge = this.addEdge(new HalfEdge(firstLeftIndex, secondLeftIndex))
                const leftEnd = this.addEdge(new HalfEdge(secondLeftIndex, second.end))

                if (first.prev === second){ 
                    first.prev = null;
                    second.next = null;
                    this.chainEdges([leftEnd, leftStart, leftEdge, leftEnd])
                } else {
                    this.chainEdges([first.prev, leftStart, leftEdge, leftEnd, second.next])
                }

                const firstRightIndex = rightPoints[(i / 2) % rightPoints.length]
                const secondRightIndex = rightPoints[(i / 2+1) % rightPoints.length]

                const rightStart = this.addEdge(new HalfEdge(second.start, secondRightIndex))
                const rightEdge = this.addEdge(new HalfEdge(secondRightIndex, firstRightIndex))
                const rightEnd = this.addEdge(new HalfEdge(firstRightIndex, first.end))

                if (second.prev === first) {
                    first.next = null;
                    second.prev = null;
                    this.chainEdges([rightEnd, rightStart, rightEdge, rightEnd])
                } else {
                    this.chainEdges([second.prev, rightStart, rightEdge, rightEnd, first.next])
                }
            }

            for (let edge of cutEdges) {
                this.deleteEdge(edge);
            }
            this.addFace(leftPoints.reverse())
            this.addFace(rightPoints)
            console.log(Array.from(this.edges.values()).filter(v => v.twin === null));
            console.log(Array.from(this.edges.values()).filter(v => v.next === null));
            console.log(Array.from(this.edges.values()).filter(v => v.prev === null));
            break;
        }
    }

    toVertices() {
        let [vertices, indices] = this.toVerticesIndices();
        let vertexArray = new Float32Array(indices.length * 3);
        indices.forEach((vertexIndex, index) => {
            vertexArray[3*index] = vertices[3*vertexIndex]
            vertexArray[3*index+1] = vertices[3*vertexIndex+1]
            vertexArray[3*index+2] = vertices[3*vertexIndex+2]
        })
        return Array.from(indices.map(vertexIndex => {
            return new THREE.Vector3(vertices[3*vertexIndex], 
                vertices[3*vertexIndex+1], vertices[3*vertexIndex+2])
        }));
    }

    toVerticesIndices() {
        const traversedEdges = [];
        var indices = [];
        for (let edge of this.edges.values()) {
            if (traversedEdges.includes(edge)) {
                continue;
            }
            traversedEdges.push(edge);
            var next = edge.next;
            while (!traversedEdges.includes(next)) {
                indices.push(edge.start,next.start,next.end);
                traversedEdges.push(next);
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
camera.position.x = 3;
camera.position.y = 3;
camera.position.z = 3;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement)


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

const planeNormal = new THREE.Vector3(0,1,0);
const planePosition = new THREE.Vector3(0,0,0);
const debugObject = {
    timeSpeed: 1.0, 
    color: 2., 
    stepVal: 0.,
    cutOffset: 0.,
    cutX: 0.,
    cutY: 1.,
    cutZ: 0.,
     }

const updatePosition = () => {
    planePosition.set(planeNormal.x,planeNormal.y,planeNormal.z).multiplyScalar(debugObject.cutOffset);
}
const updateNormal = () => {
    planeNormal.set(debugObject.cutX,debugObject.cutY,debugObject.cutZ);
    if (planeNormal.length() === 0.) {
        planeNormal.setY(1.)
    }
    planeNormal.normalize();
    updatePosition();
}
const gui = new GUI();
gui.add(debugObject, 'timeSpeed').min(0).max(3).step(0.1);
gui.add(debugObject, 'color').min(0).max(4).step(1.);
gui.add(debugObject, 'stepVal').min(-2).max(2).step(0.01);
gui.add(debugObject, 'cutOffset').min(-1).max(1).step(0.01).onChange(updatePosition);
gui.add(debugObject, 'cutX').min(-1).max(1).step(0.01).onChange(updateNormal);
gui.add(debugObject, 'cutY').min(-1).max(1).step(0.01).onChange(updateNormal);
gui.add(debugObject, 'cutZ').min(-1).max(1).step(0.01).onChange(updateNormal);

/**
 * Cut geometry
 */

const cutG = new THREE.PlaneGeometry(4, 4);
const cutM = new THREE.MeshBasicMaterial({wireframe: true})
const cutMe = new THREE.Mesh(cutG, cutM);
scene.add(cutMe);

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
function splitToNChunks(array) {
    let result = [];
    while(array.length > 0) {
        result.push(array.splice(0, 3));
    }
    return result;
}
var vertices = Array.from(boxGeo.attributes.position.array);
var indices = splitToNChunks(Array.from(boxGeo.index.array), 3);
var facesVertices = Array.from(indices.map(face => {
    return Array.from(face.map(vIndex => {
        return new THREE.Vector3(vertices[3*vIndex],vertices[3*vIndex+1],vertices[3*vIndex+2])
    }))
}))
var dcelMesh = new DcelMesh( facesVertices);

const boxMaterials = []
const boxMeshes = []
const boxDeclMeshes = []

const addDecl = decl => {
    const boxG = new THREE.BufferGeometry();
    let vertices = decl.toVertices();
    const verticesArray = new Float32Array(vertices.length * 3);
    const normalizedVertices = [];
    vertices.forEach(v => {
        if (normalizedVertices.filter(v2 => v.equals(v2)).length === 0) {
            normalizedVertices.push(v);
        }
    });
    console.log(normalizedVertices);
    const averageV = new THREE.Vector3();
    normalizedVertices.forEach(v => averageV.add(v));
    averageV.multiplyScalar(1. / normalizedVertices.length);
    vertices.forEach(v => v.sub(averageV));
    vertices.forEach((v, i) => v.toArray(verticesArray, 3*i));
    boxG.setAttribute( 'position', new THREE.BufferAttribute(verticesArray, 3));
    boxG.computeVertexNormals();
    boxG.computeBoundingBox();
    const material = new THREE.ShaderMaterial({
        wireframe: true,
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
            stepVal : {value: debugObject.stepVal},
            planePos: {value: planePosition},
            planeNormal: {value: planeNormal}
        }
    })
    boxMaterials.push(material);
    const mesh = new THREE.Mesh(boxG, material);
    averageV.multiplyScalar(2);
    console.log(averageV);
    decl.offset = averageV.clone();
    mesh.position.set(averageV.x,averageV.y,averageV.z);
    mesh.layers.enable(1);
    scene.add(mesh);
    boxMeshes.push(mesh);
    return mesh;
}

const updateDecl = newMeshes => {
    console.log(newMeshes);
    boxMeshes.forEach(v => scene.remove(v));
    boxMeshes.length = 0;
    boxDeclMeshes.length = 0;
    boxMaterials.length = 0;
    newMeshes.forEach(m => {
        boxDeclMeshes.push(m)
    })
    boxDeclMeshes.forEach(m => addDecl(m));
} 
updateDecl([dcelMesh])

const cutMesh = plane => {
    let newMeshes = boxDeclMeshes.map((m, i) => {
        dcelMesh.cut(plane)
       return dcelMesh.break();
    } )

    updateDecl(newMeshes.flat())
    
}
const cutMeshUsingPlane = () => {
    const normal = new THREE.Vector3(debugObject.cutX,debugObject.cutY,debugObject.cutZ)
    if (normal.length() === 0.) {
        normal.setY(1.)
    }
    normal.normalize();
    const newPlane = new Plane(cutMe.position.clone(), normal)
    cutMesh(newPlane);
}
debugObject.cutMeshUsingPlane = cutMeshUsingPlane
gui.add( debugObject, 'cutMeshUsingPlane' ); // Button

const rotateBox = (time) => {
    //boxMeshes.forEach(mesh => mesh.setRotationFromEuler(new THREE.Euler(0, time, 0)))
}

const updatePlane = () => {
    cutMe.position.set(planePosition.x, planePosition.y, planePosition.z);
    cutMe.lookAt(planePosition.clone().add(planeNormal));   
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
        mouse.justReleased= false;
        if (!cut.endHit || !cut.startHit) {
            return;
        }
        var diff = new THREE.Vector3();
        diff.subVectors(cut.startHit, cut.endHit);
        var planeNormal = new THREE.Vector3();
        planeNormal.crossVectors(cut.startNormal, diff).normalize();
        cutMesh(new Plane(cut.startHit, planeNormal))
        cut.endHit = null;
        cut.startHit = null;
        cut.startNormal = null;
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
    for (let boxM of boxMaterials) {
    boxM.uniforms.mIsDragging.value = mouse.end !== null;
    if (boxM.uniforms.mIsDragging.value) {
        boxM.uniforms.mStart.value = mouse.start;
        boxM.uniforms.mEnd.value = mouse.end;
    }
}
    updatePlane();
    updateCut();
    for (let boxM of boxMaterials) {
        boxM.planePos = cutMe.position;
        boxM.planeNormal = debugObject
        
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
}
    // Render scene
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
    stats.end()
}

tick()

