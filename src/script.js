import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import GUI from "lil-gui";
import overlayVertexShader from "./shaders/overlay/vertex.glsl";
import overlayFragmentShader from "./shaders/overlay/fragment.glsl";
import { gsap } from "gsap";
import Stats from "stats-js";

/**
 * Debug iterator
 */

class DebugIterator {
  constructor(max) {
    this.max = max;
    this.iteration = 0;
  }
  reset() {
    this.iteration = 0;
  }

  tick(callback = () => {}) {
    if (this.iteration++ >= this.max) {
      callback();
      throw new Error("Max iterations exceeded");
    }
  }
}

/**
 * Core objects
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};
const canvas = document.querySelector("canvas.webgl");
const renderer = new THREE.WebGLRenderer({ canvas });
const listener = new THREE.AudioListener();
renderer.setClearColor("#201919");
const scene = new THREE.Scene();
var stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/**
 * Setup camera
 */
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height);
camera.position.x = 3;
camera.position.y = 3;
camera.position.z = 3;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
camera.add(listener);

/**
 * Mouse tracking
 */
const mouse = {
  start: null,
  end: null,
  justReleased: false,
};

const lineM = new THREE.LineBasicMaterial({});
const lineV = new Float32Array(6);
const lineG = new THREE.BufferGeometry();
const line = new THREE.Line(lineG, lineM);
scene.add(line);

const mousePos = (event) => {
  return new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );
};

const calculatePlane = () => {
  if (!mouse.start || !mouse.end) {
    line.visible = false;
    return;
  }
  const startVector = new THREE.Vector3(
    mouse.start.x * camera.aspect,
    mouse.start.y,
    // no idea why -1.3 works here. BUT IT WORKS.
    -1.3
  ).applyQuaternion(camera.quaternion);

  const endVector = new THREE.Vector3(
    mouse.end.x * camera.aspect,
    mouse.end.x === mouse.start.x && mouse.end.y === mouse.start.y
      ? 0.5
      : mouse.end.y,
    -1.3
  ).applyQuaternion(camera.quaternion);

  const normal = startVector.clone().cross(endVector).normalize();
  const position = startVector
    .clone()
    .add(endVector)
    .normalize()
    .multiplyScalar(camera.position.length())
    .add(camera.position);

  const dir = endVector.sub(startVector).normalize();

  startVector
    .clone()
    .add(dir.clone().multiplyScalar(10))
    .add(camera.position)
    .toArray(lineV, 0);
  startVector
    .clone()
    .add(dir.clone().multiplyScalar(-10))
    .add(camera.position)
    .toArray(lineV, 3);

  lineG.setAttribute("position", new THREE.BufferAttribute(lineV, 3));

  return [position, normal];
};

window.addEventListener("pointermove", (event) => {
  if (
    event.target.className !== "webgl" ||
    !mouse.start ||
    event.clientY <= 0 ||
    event.clientX <= 0 ||
    event.clientX >= window.innerWidth ||
    event.clientY >= window.innerHeight
  ) {
    mouse.start = null;
    mouse.end = null;
    line.visible = false;
    return;
  }
  line.visible = true;
  if (mouse.start) {
    mouse.end = mousePos(event);
  }
  const posNorm = calculatePlane();
  updatePlane(posNorm[0], posNorm[1]);
});

window.addEventListener("pointerdown", (event) => {
  if (event.target.className !== "webgl") {
    mouse.start = null;
    mouse.end = null;
    return;
  }
  mouse.start = mousePos(event);
  mouse.end = null;
});

window.addEventListener("pointerup", (event) => {
  if (!mouse.start || !mouse.end) {
    mouse.start = null;
    mouse.end = null;
    line.visible = false;
    return;
  }
  if (event.target.className === "webgl") {
    playSound();
    const posNorm = calculatePlane();
    updatePlane(posNorm[0], posNorm[1]);
    cutMeshUsingPlane();
  }

  mouse.start = null;
  mouse.end = null;
  line.visible = false;
  mouse.justReleased = true;
});

/**
 * Debug
 */

const debugObject = {
  timeSpeed: 1.0,
  cameraControl: false,
};

const gui = new GUI();
gui.add(debugObject, "timeSpeed").min(0).max(3).step(0.1);
gui.add(debugObject, "cameraControl").onChange(() => {
  controls.enabled = debugObject.cameraControl;
});

/**
 * Loader Setup
 */

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
const gltfLoader = new GLTFLoader(loadingManager);
const audioLoader = new THREE.AudioLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
dracoLoader.setDecoderPath("./draco/gltf/");

const matcapTexture = textureLoader.load("./matcap.jpg");
const sounds = [];
const buffers = [];
const soundCount = 7;

for (let i = 0; i < soundCount; i++) {
  audioLoader.load(`swoosh0${i + 1}.mp3`, function (buffer) {
    buffers.push(buffer);
  });
}

const playSound = () => {
  let sound = sounds.filter((s) => !s.isPlaying).pop();
  if (!sound) {
    sound = new THREE.Audio(listener);
  }
  sound.setBuffer(buffers[Math.floor(Math.random() * 10000) % buffers.length]);
  sound.play();
};

/**
 * Window size
 */
const updateSize = () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  // Render
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
};
updateSize();
window.addEventListener("resize", updateSize);
window.addEventListener("orientationchange", updateSize);
window.addEventListener("dblclick", (event) => {
  if (event.target.className !== "webgl") {
    return;
  }
  const fullscreenElement =
    document.fullscreenElement || document.webkitFullscreenElement;

  if (fullscreenElement) {
    document.exitFullscreen();
  } else {
    canvas.requestFullscreen();
  }
});

/**
 * Loading overlay
 */
const overlayGeometry = new THREE.PlaneGeometry(2, 2, 1, 1);
const overlayMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  vertexShader: overlayVertexShader,
  fragmentShader: overlayFragmentShader,
  uniforms: {
    uMinY: { value: 0.0 },
    uWidthY: { value: 0.005 },
    uMaxX: { value: 0.0 },
  },
});
const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
scene.add(overlay);

/**
 * Loading Animation
 */
let progressRatio = 0.0;
let currAnimation = null;
let timeTracker = { enabled: false, deltaTime: 0, elapsedTime: 0.0 };
const updateProgress = (progress) => {
  progressRatio = Math.max(progress, progressRatio);
  if (currAnimation) {
    currAnimation.kill();
  }
  currAnimation = gsap.to(overlayMaterial.uniforms.uMaxX, {
    duration: 1,
    value: progressRatio,
  });
  if (progressRatio == 1) {
    currAnimation.kill();
    const timeline = gsap.timeline();
    currAnimation = timeline.to(overlayMaterial.uniforms.uMaxX, {
      duration: 0.2,
      value: progressRatio,
    });
    timeline.to(overlayMaterial.uniforms.uWidthY, {
      duration: 0.1,
      delay: 0.0,
      value: 0.01,
      ease: "power1.inOut",
    });
    timeline.to(overlayMaterial.uniforms.uWidthY, {
      duration: 0.1,
      value: 0.0,
      ease: "power1.in",
    });
    timeline.to(overlayMaterial.uniforms.uMinY, {
      duration: 0.5,
      value: 0.5,
      ease: "power1.in",
    });
    timeline.set(timeTracker, { enabled: true });
  }
};

const initLoadingAnimation = () => {
  if (loadingManager.itemsTotal > 0) {
    loadingManager.onProgress = (_, itemsLoaded, itemsTotal) =>
      updateProgress(itemsLoaded / itemsTotal);
  } else {
    updateProgress(1);
  }
};

/**
 * DCEL: https://en.wikipedia.org/wiki/Doubly_connected_edge_list
 */
const epslion = 1e-10;

class Plane {
  constructor(position, normal) {
    this.position = position;
    this.normal = normal.normalize();
  }

  onPlane(vertex) {
    return (
      Math.abs(vertex.clone().sub(this.position).dot(this.normal)) <= epslion
    );
  }

  intersection(start, end) {
    // if it doesn't intersect, return
    if (!this.cuts(start.clone(), end.clone())) {
      return null;
    }

    const p0 = this.position.clone();
    const l0 = start.clone();
    const l = end.clone().sub(start).normalize();
    const p0_l0 = p0.clone().sub(l0);
    const num = p0_l0.dot(this.normal);
    const denum = l.dot(this.normal);
    return l0.add(l.multiplyScalar(num / denum));
  }

  cuts(start, end) {
    let startDist = start.sub(this.position).dot(this.normal);
    let endDist = end.sub(this.position).dot(this.normal);
    return (
      endDist * startDist <= -epslion &&
      !this.onPlane(start) &&
      !this.onPlane(end)
    );
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
    if (this.twin === next) {
      console.log(this, next);
      throw new Error("setting next to twin");
    }
    if (this.end !== next.start) {
      console.log(this, next);
      throw new Error("End doesn't match start");
    }
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
    const it = new DebugIterator(1000);
    while (next !== this) {
      it.tick();
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
    return start.toString() + "+" + end.toString();
  }

  getEdge(start, end) {
    let index = this.index(start, end);
    return this.edges.get(index);
  }

  addNormalizedVertex(vertex) {
    let existingIndex = this.vertices.findIndex(
      (v) => v.distanceTo(vertex) <= epslion
    );
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
    if (edge.start === edge.end) {
      console.log(edge);
      throw new Error("Inserting edge with same start/end");
    }
    let index = this.index(edge.start, edge.end);
    if (this.edges.has(index)) {
      console.log(edge);
      console.log(this.getEdge(edge.start, edge.end));
      throw new Error("Inserting duplicate edge");
    }
    this.edges.set(index, edge);
    let twin = this.getEdge(edge.end, edge.start);
    if (twin) {
      twin.twin = edge;
      edge.twin = twin;
    }
    return edge;
  }

  deleteEdges(edges) {
    for (const edge of edges) {
      if (edge.prev && edge.prev.next === edge && !edges.includes(edge.prev)) {
        console.log(edge.prev, edge, edge.next);
        throw new Error("Deleted edge with prev");
      }
      if (edge.next && edge.next.prev === edge && !edges.includes(edge.next)) {
        console.log(edge.prev, edge, edge.next);
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
    this.deleteEdges([edge]);
  }

  getCross(e) {
    const prev = this.getVertex(e.prev.start);
    const curr = this.getVertex(e.start);
    const next = this.getVertex(e.end);
    prev.sub(curr).normalize();
    next.sub(curr).normalize();
    return next.cross(prev);
  }

  // this removes any edges that are in a larger plane
  removeInnerEdges() {
    const edges = Array.from(this.edges.values());
    // find clusters of edges which have the same normal and are linked
    const clusters = [];
    const it = new DebugIterator(1000);
    while (edges.length) {
      it.tick();
      const e = edges[0];
      const currNormal = this.getCross(e).normalize();
      const cluster = [];
      const queue = [e];
      const it2 = new DebugIterator(1000);
      while (queue.length) {
        it2.tick();
        const next = queue.pop();
        if (!edges.includes(next)) {
          continue;
        }
        const nextNorm = this.getCross(next).normalize();
        if (Math.abs(nextNorm.dot(currNormal)) >= 1 - epslion) {
          edges.splice(edges.indexOf(next), 1);
          cluster.push(next);
          queue.push(next.next, next.twin);
        }
      }

      clusters.push(cluster);
    }

    // remove any edges which have their twin in the same cluster
    for (const cluster of clusters) {
      const twinnedEdges = cluster.filter(
        (e) => cluster.includes(e.twin) && e.end > e.start
      );
      for (const edge of twinnedEdges) {
        // bridge edges before deleting
        const edgeN = edge.next;
        const edgeP = edge.prev;
        const twinN = edge.twin.next;
        const twinP = edge.twin.prev;
        this.chainEdges([twinP, edgeN]);
        this.chainEdges([edgeP, twinN]);
        this.deleteEdge(edge);
        this.deleteEdge(edge.twin);
      }
    }
  }

  removeColinearPoints() {
    let mColinearEdge = Array.from(this.edges.values())
      .filter((e) => this.getCross(e).length() <= epslion)
      .pop();
    const it = new DebugIterator(1000);
    while (mColinearEdge && this.vertices.length > 4) {
      it.tick(() => {
        console.log("mColinearEdge", mColinearEdge);
        console.log("this", this);
      });
      // move any edges related to start, to end
      const start = mColinearEdge.start;
      const end = mColinearEdge.end;
      // colinear - remove the edge and its twin, and redirect
      // the edges connected to it

      const edgesStarting = Array.from(this.edges.values()).filter(
        (e) => e.start === start && e.end !== end
      );

      edgesStarting.forEach((e) => {
        if (!this.getEdge(end, e.end)) {
          try {
            const newEdge = this.addEdge(new HalfEdge(end, e.end));
            this.chainEdges([e.prev, newEdge, e.next]);
            this.deleteEdges([e]);
          } catch (er) {
            console.log("mColinearEdge", mColinearEdge);
            console.log(this);
            console.log(end);
            console.log([e.prev, e, e.next]);
            throw er;
          }
        }
      });

      const edgesEnding = Array.from(this.edges.values()).filter(
        (e) => e.start !== end && e.end === start
      );

      edgesEnding.forEach((e) => {
        if (!this.getEdge(e.start, end)) {
          try {
            const newEdge = this.addEdge(new HalfEdge(e.start, end));
            this.chainEdges([e.prev, newEdge, e.next]);
            this.deleteEdges([e]);
          } catch (e) {
            console.log([e.prev, e, e.next]);
            throw new Error("Here");
          }
        }
      });
      mColinearEdge = Array.from(this.edges.values())
        .filter((e) => this.getCross(e).length() <= epslion)
        .pop();
    }
  }

  constructor(facesVertices) {
    this.vertices = [];
    this.edges = new Map();

    for (const face of facesVertices) {
      const vIndices = [];
      for (const vertex of face) {
        let index = this.addNormalizedVertex(vertex);
        vIndices.push(index);
      }
      this.addFace(vIndices);
    }

    this.removeInnerEdges();
    this.removeColinearPoints();

    this.checkDuplicatePoints("Constructor");
    this.validate("Constructor");
    this.validateNoColinear("Constructor");
  }

  validatePrev(validationName) {
    let missingPrev = Array.from(this.edges.values()).filter(
      (e) => e.prev === null
    );
    if (missingPrev.length > 0) {
      console.log(validationName, this);
      console.log(validationName, "Missing prev:", missingPrev);
      throw new Error("Missing prev");
    }
  }

  validateNext(validationName) {
    let missingNext = Array.from(this.edges.values()).filter(
      (e) => e.next === null
    );
    if (missingNext.length > 0) {
      console.log(validationName, this);
      console.log(validationName, "Missing next:", missingNext);
      throw new Error("Missing next");
    }
  }

  validateNoColinear(validationName) {
    const eLength = Array.from(this.edges.values()).map((e) => {
      return [
        e,
        this.getCross(e).length(),
        this.getVertex(e.prev.start),
        this.getVertex(e.start),
        this.getVertex(e.end),
      ];
    });
    if (eLength.filter((eL) => Math.abs(eL[1]) <= epslion).length > 0) {
      console.log(
        validationName,
        eLength.filter((eL) => Math.abs(eL[1]) <= epslion)
      );
      console.log(validationName, this);
      throw new Error("Colinear points");
    }
  }

  validate(validationName) {
    let missingNext = Array.from(this.edges.values()).filter(
      (e) => e.next === null
    );
    let missingPrev = Array.from(this.edges.values()).filter(
      (e) => e.prev === null
    );
    let missingTwin = Array.from(this.edges.values()).filter(
      (e) => e.twin === null
    );
    if (
      missingTwin.length > 0 ||
      missingPrev.length > 0 ||
      missingNext.length > 0
    ) {
      console.log(validationName, this);
      console.log(validationName, "Missing next:", missingNext);
      console.log(validationName, "Missing prev:", missingPrev);
      console.log(validationName, "Missing twin:", missingTwin);
      throw new Error("Missing something");
    }
  }

  checkDuplicatePoints(validationName) {
    let duplicates = this.vertices
      .map((v) => [
        v,
        this.vertices.filter((v2) => v2 !== v && v.distanceTo(v2) <= epslion),
      ])
      .filter((vL) => vL[1].length);
    if (duplicates.length) {
      console.log(validationName, "Duplicates found: ", duplicates);
      throw new Error("has duplicates");
    }
  }

  // inserts breaks in every edges where the plane would cut the edge in two
  insertPoints(plane) {
    this.checkDuplicatePoints("Before InsertPoints");
    Array.from(this.edges.values())
      .filter((e) => {
        return plane.cuts(this.getVertex(e.start), this.getVertex(e.end));
      })
      .forEach((e) => {
        const vertex = plane.intersection(
          this.getVertex(e.start),
          this.getVertex(e.end)
        );
        const index = this.addNormalizedVertex(vertex);
        let next = e.next;
        let prev = e.prev;
        let e1 = this.addEdge(new HalfEdge(prev.end, index));
        let e2 = this.addEdge(new HalfEdge(index, next.start));
        this.chainEdges([prev, e1, e2, next]);
        this.deleteEdge(e);
      });
    this.checkDuplicatePoints("After InsertPoints");
    this.validate("After point insert");
  }

  // Ensures that there are edges between all points that sit on the plane.
  insertLoops(plane) {
    this.validate("Before insertLoops");
    const vIndices = Array.from(
      this.vertices
        .map((v, i) => [v, i])
        .filter((vi) => plane.onPlane(vi[0]))
        .map((vi) => vi[1])
    );
    const loops = [];
    if (vIndices.length < 3) {
      return;
    }

    const it = new DebugIterator(1000);
    while (vIndices.length) {
      it.tick();
      const loop = [];
      let mNextV = vIndices[0];

      const it2 = new DebugIterator(1000);
      while (mNextV !== undefined) {
        it2.tick();
        loop.push(mNextV);
        vIndices.splice(vIndices.indexOf(mNextV), 1);
        mNextV = Array.from(this.edges.values())
          .filter((e) => e.start === mNextV)
          .map((e) => e.getLoop())
          .map((loop) =>
            loop.filter((e) => vIndices.includes(e.start)).map((e) => e.start)
          )
          .filter((loop) => loop.length > 0)
          .map((loop) => loop.pop())
          .pop();
      }
      if (loop.length < 3) {
        console.log(vIndices);
        console.log(vIndices.map((i) => this.getVertex(i)));
        console.log(loop);
        console.log(loop.map((i) => this.getVertex(i)));
        throw new Error("Loop too short");
      }
      loops.push(loop);
    }

    const it3 = new DebugIterator(1000);
    while (loops.length) {
      it3.tick();
      const loop = loops.pop();
      for (let i = 0; i < loop.length; i++) {
        const start = loop[i];
        const end = loop[(i + 1) % loop.length];
        // find the face containing both start and end
        const edge = this.getEdge(start, end);
        const face = Array.from(this.edges.values())
          .filter((e) => e.start === start)
          .map((e) => e.getLoop())
          .filter((loop) => loop.filter((e) => e.start === end).length > 0)
          .pop();

        if (!face) {
          console.log("face", face);
          console.log(this);
          console.log(loop);
          console.log(loop.map((i) => this.getVertex(i)));
          console.log(edge);
          console.log(start, end);
          console.log(this.getVertex(start));
          console.log(this.getVertex(end));
          throw new Error("No face with start and finish");
        }

        if (!this.getEdge(start, end)) {
          const startIn = face.filter((e) => e.end === start).pop();
          const endOut = face.filter((e) => e.start === end).pop();
          const startEnd = this.addEdge(new HalfEdge(start, end));
          this.chainEdges([startIn, startEnd, endOut]);
        }

        if (!this.getEdge(end, start)) {
          const startOut = face.filter((e) => e.start === start).pop();
          const endIn = face.filter((e) => e.end === end).pop();
          const endStart = this.addEdge(new HalfEdge(end, start));
          this.chainEdges([endIn, endStart, startOut]);
        }
      }
    }
    this.validate("After insertLoops");
  }

  // find all edges that are entirely contained within the plane, and insert cuts at the loops.
  cutLoops(plane) {
    this.validate("Before cutLoops");
    const edges = Array.from(
      Array.from(this.edges.values()).filter(
        (e) =>
          plane.onPlane(this.getVertex(e.start)) &&
          plane.onPlane(this.getVertex(e.end))
      )
    );
    if (edges.length < 3) {
      return;
    }

    const chains = [];
    const it = new DebugIterator(1000);
    while (edges.length) {
      it.tick();
      const chain = [];
      let mNextE = edges[0];
      const it2 = new DebugIterator(1000);
      while (mNextE) {
        it2.tick();
        chain.push(mNextE);
        edges.splice(edges.indexOf(mNextE), 1);
        mNextE = edges
          .filter((e) => e.start === mNextE.end && e.end !== mNextE.start)
          .pop();
      }
      if (chain.length < 3) {
        console.log("edges", edges);
        console.log("chain", chain);
        throw new Error("Chain too short");
      }
      chains.push(chain);
    }

    // make a copy of the edge vertices
    const chainsWithNewVertex = chains.map((chain) =>
      chain.map((e) => [e, this.addVertex(this.getVertex(e.start))])
    );
    this.validate("Added new vertices");

    // replace the old vertices
    chainsWithNewVertex.forEach((chainWithVert) => {
      for (let i = 0; i < chainWithVert.length; i++) {
        const e = chainWithVert[i][0];
        const newV = chainWithVert[i][1];

        const edgePairsToReplace = [[e.prev, e]];
        const it = new DebugIterator(1000);
        while (
          !chainWithVert
            .map((ev) => ev[0])
            .includes(edgePairsToReplace[edgePairsToReplace.length - 1][0])
        ) {
          it.tick();
          const outEdge =
            edgePairsToReplace[edgePairsToReplace.length - 1][0].twin;
          const inEdge = outEdge.prev;
          edgePairsToReplace.push([inEdge, outEdge]);
        }

        for (let i = 0; i < edgePairsToReplace.length; i++) {
          const inEdge = edgePairsToReplace[i][0];
          const outEdge = edgePairsToReplace[i][1];

          const newIn = this.addEdge(new HalfEdge(inEdge.start, newV));
          const newOut = this.addEdge(new HalfEdge(newV, outEdge.end));
          this.chainEdges([inEdge.prev, newIn, newOut, outEdge.next]);

          const edgeIndex1 = chainWithVert.findIndex((ev) => ev[0] === outEdge);
          const edgeIndex2 = chainWithVert.findIndex((ev) => ev[0] === inEdge);
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
      const newLoop = chainWithVert
        .reverse()
        .map((ev, i) =>
          this.addEdge(
            new HalfEdge(
              ev[1],
              chainWithVert[(i + 1) % chainWithVert.length][1]
            )
          )
        );
      newLoop.push(newLoop[0]);
      this.chainEdges(newLoop);
      this.validatePrev("ReplaceVertex");
      this.validateNext("ReplaceVertex");
    });

    this.validate("Post cutLoops");
  }

  // Gets arrays of edges that are connected
  edgeClusters() {
    const edges = Array.from(this.edges.values());
    const clusters = [];
    const it = new DebugIterator(1000);
    while (edges.length) {
      it.tick();
      const queue = [edges[0]];
      let cluster = [];

      const it2 = new DebugIterator(1000);
      while (queue.length) {
        it2.tick();
        const edge = queue.pop();
        if (!edges.includes(edge)) {
          continue;
        }
        cluster.push(edge);
        edges.splice(edges.indexOf(edge), 1);
        queue.push(edge.twin, edge.next);
      }
      clusters.push(cluster);
    }

    return clusters;
  }

  // tries to break the mesh into seperate pieces
  break() {
    const clusters = this.edgeClusters();

    if (clusters.length === 1) {
      return null;
    }

    // generate the faces for each cluster
    return clusters.map((cluster) => {
      const faces = [];
      const it = new DebugIterator(1000);
      while (cluster.length) {
        it.tick();
        let edge = cluster[0];
        const face = [];
        const it2 = new DebugIterator(1000);
        while (!face.includes(edge)) {
          it2.tick();
          face.push(edge);
          edge = edge.next;
          cluster.splice(cluster.indexOf(edge), 1);
        }
        faces.push(Array.from(face.map((e) => this.getVertex(e.start))));
      }
      return faces;
    });
  }

  chainEdges(edges) {
    edges.forEach((e, i) => {
      if (i < edges.length - 1) {
        e.setNext(edges[i + 1]);
      }
    });
  }

  addFace(indices) {
    let edges = indices.map(
      (v, i) => new HalfEdge(v, indices[(i + 1) % indices.length])
    );
    edges.forEach((e) => this.addEdge(e));
    edges.push(edges[0]);
    this.chainEdges(edges);
  }

  cut(plane) {
    this.insertPoints(plane);
    this.insertLoops(plane);
    this.cutLoops(plane);
  }

  toVertices() {
    let [vertices, indices] = this.toVerticesIndices();
    return indices.map(
      (vertexIndex) =>
        new THREE.Vector3(
          vertices[3 * vertexIndex],
          vertices[3 * vertexIndex + 1],
          vertices[3 * vertexIndex + 2]
        )
    );
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
      const it = new DebugIterator(1000);
      while (!traversedEdges.includes(next)) {
        it.tick();
        indices.push(edge.start, next.start, next.end);
        traversedEdges.push(next);
        next = next.next;
      }
    }
    let vertexArray = new Float32Array(this.vertices.length * 3);
    this.vertices.forEach((v, i) => v.toArray(vertexArray, 3 * i));
    return [vertexArray, indices];
  }
}

/**
 * Cut geometry
 */

const cutG = new THREE.PlaneGeometry(4, 4);
const cutM = new THREE.MeshBasicMaterial({ wireframe: true });
const cutMe = new THREE.Mesh(cutG, cutM);
cutMe.worldLookAt = () => {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(cutMe.quaternion);
};
cutMe.visible = false;
scene.add(cutMe);

const updatePlane = (position, normal) => {
  cutMe.position.set(position.x, position.y, position.z);
  cutMe.lookAt(normal.clone().add(cutMe.position));
};

/**
 *  Box
 */

const root = new THREE.Group();
root.position.set(0, 0, 0);
scene.add(root);
const boxDecl = () => {
  const boxGeo = new THREE.BoxGeometry();
  function splitToNChunks(array) {
    let result = [];
    const it = new DebugIterator(1000);
    while (array.length > 0) {
      it.tick();
      result.push(array.splice(0, 3));
    }
    return result;
  }
  var vertices = Array.from(boxGeo.attributes.position.array);
  var indices = splitToNChunks(Array.from(boxGeo.index.array), 3);
  var facesVertices = Array.from(
    indices.map((face) => {
      return Array.from(
        face.map((vIndex) => {
          return new THREE.Vector3(
            vertices[3 * vIndex],
            vertices[3 * vIndex + 1],
            vertices[3 * vIndex + 2]
          );
        })
      );
    })
  );
  return new DcelMesh(facesVertices);
};

const makeMesh = (
  decl,
  pos = new THREE.Vector3(),
  targetPos = new THREE.Vector3()
) => {
  const boxG = new THREE.BufferGeometry();
  const vertices = decl.toVertices();
  const verticesArray = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    v.toArray(verticesArray, 3 * i);
  });
  boxG.setAttribute("position", new THREE.BufferAttribute(verticesArray, 3));
  boxG.computeVertexNormals();
  boxG.computeBoundingBox();
  const material = new THREE.MeshMatcapMaterial({ matcap: matcapTexture });
  const mesh = new THREE.Mesh(boxG, material);
  mesh.decl = decl;
  mesh.layers.enable(1);
  root.add(mesh);
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.targetPos = targetPos.clone();
  gsap.to(mesh.position, {
    duration: 1.5,
    x: targetPos.x,
    y: targetPos.y,
    z: targetPos.z,
    ease: "elastic.out",
  });
};

makeMesh(boxDecl());

const cutMesh = (mesh, plane) => {
  mesh.decl.cut(plane);
  const mFaces = mesh.decl.break();
  if (!mFaces) {
    return;
  }
  mFaces.forEach((faces) => {
    const vertices = faces.flat();
    const dedupVertices = vertices.filter(
      (v, i) =>
        vertices.filter((v2, j) => j < i && v.distanceTo(v2) <= epslion)
          .length === 0
    );
    const average = dedupVertices
      .reduce((acc, v) => acc.add(v), new THREE.Vector3())
      .multiplyScalar(1 / dedupVertices.length);
    faces.forEach((face) => face.forEach((v) => v.sub(average)));
    const distanceScale = 2.5;
    const pos = mesh.targetPos
      .clone()
      .multiplyScalar(1 / distanceScale)
      .add(average);
    makeMesh(
      new DcelMesh(faces),
      mesh.position.clone(),
      pos.clone().multiplyScalar(distanceScale)
    );
  });
  root.remove(mesh);
};

const cutMeshUsingPlane = () => {
  const meshQueue = Array.from(root.children);
  const it = new DebugIterator(meshQueue.length + 2);
  while (meshQueue.length) {
    it.tick();
    const mesh = meshQueue.pop();
    const pos = cutMe.position.clone();
    const norm = cutMe.worldLookAt();
    mesh.attach(cutMe);
    const newPlane = new Plane(cutMe.position.clone(), cutMe.worldLookAt());
    cutMesh(mesh, newPlane);
    scene.attach(cutMe);
    cutMe.position.set(pos.x, pos.y, pos.z);
    cutMe.lookAt(norm.add(pos));
  }
};
debugObject.cutMeshUsingPlane = cutMeshUsingPlane;
gui.add(debugObject, "cutMeshUsingPlane"); // Button

const randomCut = () => {
  cutMeshUsingPlane();
};

debugObject.randomCut = randomCut;
gui.add(debugObject, "randomCut"); // Button

/**
 * Plane cut
 */

const raycaster = new THREE.Raycaster(camera.position);
raycaster.layers.set(1);

const rotateRoot = (deltaTime) => {
  root.rotateY(deltaTime);
};

/**
 * Animation
 */
let hasCut = false;
const clock = new THREE.Clock();
const tick = () => {
  stats.begin();
  if (timeTracker.enabled) {
    timeTracker.deltaTime = debugObject.timeSpeed * clock.getDelta();
    timeTracker.elapsedTime = timeTracker.elapsedTime + timeTracker.deltaTime;
  }

  // cut
  const randomCutCount = 0;
  if (!hasCut && timeTracker.elapsedTime > 1) {
    hasCut = true;
    for (let i = 0; i < randomCutCount; i++) {
      randomCut();
    }
  }
  // update controls
  controls.update();
  rotateRoot(timeTracker.deltaTime);

  // Render scene
  renderer.render(scene, camera);

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  stats.end();
};
initLoadingAnimation();
tick();
