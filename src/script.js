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
const epslion = 0.000001;

class Plane {
    constructor(position, normal) {
        this.position = position;
        this.normal = normal.normalize();
    }

    onPlane(vertex) {
      return Math.abs(vertex.clone().sub(this.position).dot(this.normal)) < epslion;
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
        return endDist * startDist < -epslion && !this.onPlane(start) && !this.onPlane(end);
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
    
    getLoop() {
        const loop = [this];
        let next = this.next;
        while (next !== this) {
            loop.push(next);
            next = next.next;
        }
        return loop;
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
    let existingIndex = this.vertices.findIndex(v => v.distanceTo(vertex) < epslion);
    if (existingIndex >= 0) {
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

    deleteEdges(edges) {
        for (const edge of edges) {
            if (edge.prev && edge.prev.next === edge && !edges.includes(edge.prev)) {
                console.log(edge.prev,edge, edge.next)
                throw new Error("Deleted edge with prev");
            } 
            if (edge.next && edge.next.prev === edge && !edges.includes(edge.next)) {
                console.log(edge.prev,edge, edge.next)
                throw new Error("Deleted edge with next");
            }
            const index = this.index(edge.start, edge.end);
            this.edges.delete(index);
            let twin = this.getEdge(edge.end, edge.start);
            if (twin) {
                twin.twin = null;
            }
        }
    }

    deleteEdge(edge) {
        this.deleteEdges([edge])
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

        this.checkDuplicatePoints("Constructor");
        this.validate("Constructor")
    }

    validatePrev(validationName) {
        let missingPrev = Array.from(this.edges.values()).filter(e => e.prev === null);
        if ( missingPrev.length > 0) {
            console.log(validationName,this)
            console.log(validationName,"Missing prev:",missingPrev);
            throw new Error("Missing prev")
        }
    }

    validateNext(validationName) {
        let missingNext = Array.from(this.edges.values()).filter(e => e.next === null);
        if (missingNext.length > 0) {
            console.log(validationName,this)
            console.log(validationName,"Missing next:",missingNext);
            throw new Error("Missing next")
        }
    }

    validate(validationName) {
        let missingNext = Array.from(this.edges.values()).filter(e => e.next === null);
        let missingPrev = Array.from(this.edges.values()).filter(e => e.prev === null);
        let missingTwin = Array.from(this.edges.values()).filter(e => e.twin === null);
        if (missingTwin.length > 0 || missingPrev.length > 0 || missingNext.length > 0) {
            console.log(validationName,this)
            console.log(validationName,"Missing next:",missingNext);
            console.log(validationName,"Missing prev:",missingPrev);
            console.log(validationName,"Missing twin:",missingTwin);
            throw new Error("Missing something")
        }
    }

    checkDuplicatePoints(validationName) {
        let duplicates = this.vertices
            .map(v => [v, this.vertices
                .filter(v2 => v2 !== v && v.distanceTo(v2) < epslion)])
            .filter(vL => vL[1].length);
        if (duplicates.length) {
            console.log(validationName,"Duplicates found: ", duplicates)
            throw new Error("has duplicates")
        }
    }

    // inserts breaks in every edges where the plane would cut the edge in two
    insertPoints(plane) {
        this.checkDuplicatePoints("Before InsertPoints");
        Array.from(this.edges.values()).filter(e => {
            return plane.cuts(this.getVertex(e.start), this.getVertex(e.end));
        }).forEach(e => {
            const vertex = plane.intersection(this.getVertex(e.start), this.getVertex(e.end));
            const index = this.addNormalizedVertex(vertex);
            let next = e.next;
            let prev = e.prev;
            let e1 = this.addEdge(new HalfEdge(prev.end, index));
            let e2 = this.addEdge(new HalfEdge(index, next.start));
            this.chainEdges([prev, e1, e2, next])
            this.deleteEdge(e);
        })
        this.checkDuplicatePoints("After InsertPoints");
        this.validate("After point insert");
    }

    // Ensures that there are edges between all points that sit on the plane.
    insertLoops(plane) {
        this.validate("Before insertLoops");
        const vIndices = Array.from(this.vertices
            .map((v,i) => [v, i])
            .filter(vi => plane.onPlane(vi[0]))
            .map(vi => vi[1]));
        const loops = []
        while (vIndices.length) {
            const loop = []
            let mNextV = vIndices[0];
            while (mNextV) {
                loop.push(mNextV);
                vIndices.splice(vIndices.indexOf(mNextV), 1);
                mNextV = Array.from(this.edges.values())
                    .filter(e => e.start === mNextV)
                    .map(e => e.getLoop())
                    .map(loop => loop.filter(e => vIndices.includes(e.start)).map(e => e.start))
                    .filter(loop => loop.length > 0)
                    .map(loop => loop.pop())
                    .pop();
            }
            loops.push(loop);
        }

        const insertedEdgeLoops = []
        while (loops.length) {
            const loop = loops.pop();
            for (let i = 0; i < loop.length; i++) {
                const start = loop[i];
                const end = loop[(i+1) % loop.length];
                // find the face containing both start and end
                const face = Array.from(this.edges.values())
                    .filter(e => e.start === start)
                    .map(e => e.getLoop())
                    .filter(loop => loop.filter(e => e.start === end).length > 0)
                    .pop();

                if (!face) {
                    console.log(face);
                }
                
                const startIn = face.filter(e => e.end === start).pop();
                const startOut = face.filter(e => e.start === start).pop();
                const endIn = face.filter(e => e.end === end).pop();
                const endOut = face.filter(e => e.start === end).pop();

                const startEnd = this.addEdge(new HalfEdge(start, end));
                const endStart = this.addEdge(new HalfEdge(end, start));

                this.chainEdges([startIn, startEnd, endOut]);
                this.chainEdges([endIn, endStart, startOut]);
            }
        }
        this.validate("After insertLoops");
    }

    // find all edges that are entirely contained within the plane, and insert cuts at the loops.
    cutLoops(plane) {
        this.validate("Before cutLoops");
        const edges = Array.from(Array.from(this.edges.values()).filter(
            e => plane.onPlane(this.getVertex(e.start)) && plane.onPlane(this.getVertex(e.end))
        ))

        const chains = []
        while (edges.length) {
            const chain = [];
            let mNextE = edges[0];
            while (mNextE) {
                chain.push(mNextE);
                edges.splice(edges.indexOf(mNextE), 1);
                mNextE = edges.filter(e => e.start === mNextE.end && e.end !== mNextE.start).pop();
            }
            chains.push(chain);
        }

        // make a copy of the edge vertices
        const chainsWithNewVertex = chains
            .map(chain => chain
                .map(e => [e, this.addVertex(this.getVertex(e.start))])
                )
        this.validate("Added new vertices");

        console.log(chainsWithNewVertex)
        // replace the old vertices
        chainsWithNewVertex.forEach((chainWithVert, j) => {
            for (let i = 0; i < chainWithVert.length; i++) {
                console.log(j,i)
                console.log(chainWithVert)
                const e = chainWithVert[i][0];
                const newV = chainWithVert[i][1];
                
                const edgePairsToReplace = [[e.prev, e]]
                while (!chainWithVert.map(ev => ev[0])
                    .includes(edgePairsToReplace[edgePairsToReplace.length - 1][0])) {
                    const outEdge = edgePairsToReplace[edgePairsToReplace.length - 1][0].twin;
                    const inEdge = outEdge.prev;
                    edgePairsToReplace.push([inEdge, outEdge])
                }

                for (let i = 0; i < edgePairsToReplace.length; i++) {
                    const inEdge = edgePairsToReplace[i][0];
                    const outEdge = edgePairsToReplace[i][1];

                    const newIn = this.addEdge(new HalfEdge(inEdge.start, newV));
                    const newOut = this.addEdge(new HalfEdge(newV, outEdge.end));
                    this.chainEdges([inEdge.prev, newIn, newOut, outEdge.next]);

                    const edgeIndex1 = chainWithVert.findIndex(ev => ev[0] === outEdge);
                    const edgeIndex2 = chainWithVert.findIndex(ev => ev[0] === inEdge);
                    if (edgeIndex1 >= 0) {
                        chainWithVert[edgeIndex1][0] = newOut;
                    }
                    if (edgeIndex2 >= 0) {
                        chainWithVert[edgeIndex2][0] = newIn;
                    }
                    this.deleteEdges([outEdge, inEdge]);
                    this.validatePrev("ReplaceVertexLoop");
                    this.validateNext("ReplaceVertexLoop");
                }
                this.validatePrev("ReplaceVertexLoop");
                this.validateNext("ReplaceVertexLoop");
            }

            this.validatePrev("ReplaceVertex");
            this.validateNext("ReplaceVertex");
            const newLoop = chainWithVert.reverse().map((ev, i) => this.addEdge(new HalfEdge(
                ev[1], chainWithVert[(i+1) % chainWithVert.length][1]
            )));
            newLoop.push(newLoop[0]);
            this.chainEdges(newLoop);
            console.log(newLoop)
            this.validatePrev("ReplaceVertex");
            this.validateNext("ReplaceVertex");
        });

        this.validate("Post cutLoops");
    }

    // Gets arrays of edges that are connected
    edgeClusters() {
        const edges = Array.from(this.edges.values());
        const clusters = []
        while (edges.length) {
            const queue = [edges[0]]
            let cluster = [];
            while (queue.length) {
                const edge = queue.pop();
                if (!edges.includes(edge)) {
                    continue;
                }
                cluster.push(edge)
                edges.splice(edges.indexOf(edge), 1);
                queue.push(edge.twin, edge.next);
            }
            clusters.push(cluster);
        }

        return clusters;
    }

    // tries to break the mesh into seperate pieces
    break() {
        const clusters = this.edgeClusters()

        // generate the faces for each cluster
        const clusteredFaces = clusters.map(cluster => {
            const faces = []
            while (cluster.length) {
                let edge = cluster[0];
                const face = [];
                while (!face.includes(edge)) {
                    face.push(edge);
                    edge = edge.next;
                    cluster.splice(cluster.indexOf(edge), 1);
                }
                faces.push(Array.from(face.map(e => this.getVertex(e.start))));
            }
            return faces;
        })

        // generate a dcel mesh for each
        let meshes = clusteredFaces.map(faces => new DcelMesh(faces));
        
        return meshes;
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
        this.insertPoints(plane);
        this.insertLoops(plane);
        this.cutLoops(plane);
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
            // This does not handle colinear edges at all.
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
    const averageV = new THREE.Vector3();
    normalizedVertices.forEach(v => averageV.add(v));
    averageV.multiplyScalar(1. / normalizedVertices.length);
    averageV.set(0,0,0);
    vertices.forEach(v => v.sub(averageV));
    vertices.forEach((v, i) => v.toArray(verticesArray, 3*i));
    boxG.setAttribute('position', new THREE.BufferAttribute(verticesArray, 3));
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
    decl.offset = averageV.clone();
    mesh.position.set(averageV.x,averageV.y,averageV.z);
    mesh.layers.enable(1);
    scene.add(mesh);
    boxMeshes.push(mesh);
    return mesh;
}

const updateDecl = newMeshes => {
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
        m.cut(plane)
       return m.break();
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

cutMeshUsingPlane();
debugObject.cutX = 0.75;
updateNormal();
cutMeshUsingPlane();

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

