import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import GUI from "lil-gui";
import screenSlashVertexShader from "./shaders/screenSlash/vertex.glsl";
import screenSlashFragmentShader from "./shaders/screenSlash/fragment.glsl";
import dissolveVertexShader from "./shaders/dissolve/vertex.glsl";
import dissolveFragmentShader from "./shaders/dissolve/fragment.glsl";
import loadingVertexShader from "./shaders/loading/vertex.glsl";
import loadingFragmentShader from "./shaders/loading/fragment.glsl";
import { gsap } from "gsap";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import Stats from "stats-js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

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
  verticalOffset: 0,
  horizontalOffset: 0,
};
const topLevelContainer = document.querySelector("div.webglcontainer");
const canvasContainer = document.querySelector("div.relative");
const canvas = document.querySelector("canvas.webgl");
const uiContainer = document.querySelector("div.ui");
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
const camera = new THREE.PerspectiveCamera(55, 16 / 9);
camera.position.x = 0;
camera.position.y = 0;
camera.position.z = 4;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
camera.add(listener);

/**
 * Composer
 */
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

/**
 * Mouse tracking
 */
const mouse = {
  start: null,
  end: null,
  lastHit: 1000,
};

const lineM = new THREE.LineBasicMaterial({});
const lineV = new Float32Array(6);
const lineG = new THREE.BufferGeometry();
const line = new THREE.Line(lineG, lineM);
scene.add(line);

const mousePos = (event) => {
  return new THREE.Vector2(
    ((event.clientX - sizes.horizontalOffset) / sizes.width) * 2 - 1,
    -((event.clientY - sizes.verticalOffset) / sizes.height) * 2 + 1
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
    // no idea why -1.9 works here. BUT IT WORKS.
    -1.9
  ).applyQuaternion(camera.quaternion);

  const endVector = new THREE.Vector3(
    mouse.end.x * camera.aspect,
    mouse.end.x === mouse.start.x && mouse.end.y === mouse.start.y
      ? 0.5
      : mouse.end.y,
    -1.9
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
    event.clientY <= sizes.verticalOffset ||
    event.clientX <= sizes.horizontalOffset ||
    event.clientX >= sizes.width + sizes.horizontalOffset ||
    event.clientY >= sizes.height + sizes.verticalOffset
  ) {
    mouse.start = null;
    mouse.end = null;
    line.visible = false;
    return;
  }
  line.visible = false;
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

const intersectionLines = (v1, d1, v2, d2) => {
  const c = d2.clone().cross(d1);
  if (Math.abs(c) <= epslion) {
    return null;
  }
  return v2.clone().sub(v1).cross(d1) / c;
};

const walls = [
  [new THREE.Vector2(0, 0), new THREE.Vector2(1, 0)],
  [new THREE.Vector2(0, 0), new THREE.Vector2(0, 1)],
  [new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)],
  [new THREE.Vector2(0, 1), new THREE.Vector2(1, 0)],
];

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
    const p2 = new THREE.Vector2(
      (mouse.start.x + 1) / 2,
      (mouse.start.y + 1) / 2
    );
    const pEnd = new THREE.Vector2(
      (mouse.end.x + 1) / 2,
      (mouse.end.y + 1) / 2
    );
    const d2 = pEnd.clone();
    d2.sub(p2).normalize();
    const dNeg2 = d2.clone().multiplyScalar(-1);

    const end = walls
      .map((pd) => {
        return intersectionLines(
          pd[0].clone(),
          pd[1].clone(),
          p2.clone(),
          dNeg2.clone()
        );
      })
      .filter((v) => v !== null && v >= 0)
      .reduce((acc, v) => Math.min(v, acc), 1000);
    const start = walls
      .map((pd) => {
        return intersectionLines(
          pd[0].clone(),
          pd[1].clone(),
          p2.clone(),
          d2.clone()
        );
      })
      .filter((v) => v !== null && v >= 0)
      .reduce((acc, v) => Math.min(v, acc), 1000);

    const uStart = p2.clone().add(dNeg2.clone().multiplyScalar(start));
    const uEnd = p2.clone().add(d2.clone().multiplyScalar(end));
    slashUniforms.uStart.value = uStart.clone();
    slashUniforms.uEnd.value = uEnd.clone();
    slashUniforms.uSlashTime.value = timeTracker.elapsedTime;
    cutMeshUsingPlane();
  }

  mouse.start = null;
  mouse.end = null;
  line.visible = false;
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
gui.hide();

/**
 * Loader Setup
 */

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
const gltfLoader = new GLTFLoader(loadingManager);
const audioLoader = new THREE.AudioLoader(loadingManager);
const fontLoader = new FontLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
dracoLoader.setDecoderPath("./draco/gltf/");

/**
 * Textures
 */

const matcapTexture = textureLoader.load("./matcap01.png");

/**
 * Fonts
 */
const fonts = [];
fontLoader.load("./fonts/helvetiker_regular.typeface.json", function (font) {
  fonts.push(font);
  const geometry = new TextGeometry("SLICE TO START", {
    font: font,
    size: 0.4,
    height: 0.05,
    curveSegments: 1,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelSegments: 1,
    bevelThickness: 0.05,
  });
  geometry.center();
  geoToDecl(geometry, dissolveThresholdCut(0.008));
});

/**
 * Sound
 */

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
  if (window.innerHeight * camera.aspect > window.innerWidth) {
    sizes.width = window.innerWidth;
    sizes.height = window.innerWidth / camera.aspect;
    sizes.verticalOffset = (window.innerHeight - sizes.height) / 2;
    sizes.horizontalOffset = 0;
  } else {
    sizes.width = window.innerHeight * camera.aspect;
    sizes.height = window.innerHeight;
    sizes.verticalOffset = 0;
    sizes.horizontalOffset = (window.innerWidth - sizes.width) / 2;
  }
  canvasContainer.style.top = sizes.verticalOffset.toString() + "px";
  canvasContainer.style.left = sizes.horizontalOffset.toString() + "px";

  // Render
  renderer.setSize(sizes.width, sizes.height);
  composer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    topLevelContainer.requestFullscreen();
  }
});

/**
 * Slash overlay
 */
const slashShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStart: { value: new THREE.Vector2() },
    uEnd: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uSlashTime: { value: -100 },
  },
  vertexShader: screenSlashVertexShader,
  fragmentShader: screenSlashFragmentShader,
};

const slashScreen = new ShaderPass(slashShader);
const slashUniforms = slashScreen.material.uniforms;
composer.addPass(slashScreen);

/**
 * Loading overlay
 */
const loadingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMinY: { value: 0.0 },
    uWidthY: { value: 0.005 },
    uMaxX: { value: 0.0 },
  },
  vertexShader: loadingVertexShader,
  fragmentShader: loadingFragmentShader,
};

const loadingScreen = new ShaderPass(loadingShader);
const loadingUniforms = loadingScreen.material.uniforms;
composer.addPass(loadingScreen);

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
  currAnimation = gsap.to(loadingUniforms.uMaxX, {
    duration: 1,
    value: progressRatio,
  });
  if (progressRatio == 1) {
    currAnimation.kill();
    const timeline = gsap.timeline();
    currAnimation = timeline.to(loadingUniforms.uMaxX, {
      duration: 0.2,
      value: progressRatio,
    });
    timeline.set(timeTracker, { enabled: true });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      delay: 0.0,
      value: 0.01,
      ease: "power1.inOut",
    });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      value: 0.0,
      ease: "power1.in",
    });
    timeline.to(loadingUniforms.uMinY, {
      duration: 0.5,
      value: 0.5,
      ease: "power1.in",
    });
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
    return Math.abs(this.signedDistance(vertex)) <= epslion;
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

  signedDistance(vertex) {
    return vertex.clone().sub(this.position).dot(this.normal);
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
    if (next.next === this) {
      console.log(this, next);
      throw new Error("creating 2 length loop");
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
    const it = new DebugIterator(100000);
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

  getEdges(start = undefined, end = undefined) {
    const edges = [];
    if (!start && !end) {
      const it = this.edgeMap.values();
      let v = it.next();
      while (!v.done) {
        const it2 = v.value.values();
        let v2 = it2.next();
        while (!v2.done) {
          edges.push(v2.value);
          v2 = it2.next();
        }
        v = it.next();
      }
    } else if (start && !end) {
      let s = this.edgeMap.get(start);
      if (s) {
        const it = s.values();
        let v = it.next();
        while (!v.done) {
          edges.push(v.value);
          v = it.next();
        }
      }
    } else if (!start && end) {
      let s = this.edgeMap.get(end);
      if (s) {
        const it = s.values();
        let v = it.next();
        while (!v.done) {
          edges.push(v.value.prev);
          v = it.next();
        }
      }
    } else if (start && end) {
      const e = this.getEdge(start, end);
      if (e) {
        edges.push(e);
      }
    }
    return edges;
  }

  getEdge(start, end) {
    const m = this.edgeMap.get(start);
    return !m ? m : m.get(end);
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
    if (this.getEdge(edge.start, edge.end)) {
      console.log(edge);
      console.log(this.getEdge(edge.start, edge.end));
      throw new Error("Inserting duplicate edge");
    }
    if (!this.edgeMap.has(edge.start)) {
      this.edgeMap.set(edge.start, new Map());
    }
    this.edgeMap.get(edge.start).set(edge.end, edge);
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
      this.edgeMap.get(edge.start).delete(edge.end);
      if (!this.edgeMap.get(edge.start).size) {
        this.edgeMap.delete(edge.start);
      }
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
    const edges = this.getEdges();
    // find clusters of edges which have the same normal and are linked
    const clusters = [];
    const it = new DebugIterator(100000);
    while (edges.length) {
      it.tick();
      const e = edges[0];
      const currNormal = this.getCross(e).normalize();
      const cluster = [];
      const queue = [e];
      const it2 = new DebugIterator(100000);
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
    let mColinearEdge = this.getEdges()
      .filter((e) => this.getCross(e).length() <= epslion)
      .pop();
    const it = new DebugIterator(100000);
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

      const edgesStarting = this.getEdges(start, undefined);

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

      const edgesEnding = this.getEdges(undefined, start);

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
      mColinearEdge = this.getEdges()
        .filter((e) => this.getCross(e).length() <= epslion)
        .pop();
    }
  }

  calculateCentroid() {
    const averagePoint = this.vertices
      .reduce((acc, v) => acc.add(v), new THREE.Vector3())
      .multiplyScalar(1 / this.vertices.length);

    const edgeToParse = this.getEdges();

    const faces = [];
    while (edgeToParse.length > 0) {
      const e = edgeToParse[0];
      const face = e.getLoop();
      for (const edge of face) {
        edgeToParse.splice(edgeToParse.indexOf(edge), 1);
      }
      faces.push(face);
    }

    const centroids = [];
    for (const face of faces) {
      const v1 = this.getVertex(face[0].start);
      for (let i = 1; i < face.length - 1; i++) {
        const edge = face[i];
        const v2 = this.getVertex(edge.start);
        const v3 = this.getVertex(edge.end);
        const centroid = averagePoint
          .clone()
          .add(v1)
          .add(v2)
          .add(v3)
          .multiplyScalar(0.25);

        // Heron's Formula: https://en.wikipedia.org/wiki/Heron%27s_formula
        const a = v1.distanceTo(v2);
        const b = v2.distanceTo(v3);
        const c = v3.distanceTo(v1);
        const s = (a + b + c) / 2;
        const baseArea = Math.sqrt(s * (s - a) * (s - b) * (s - c));
        const cross = v1.clone().sub(v2).cross(v3.clone().sub(v2));
        if (cross.length() <= epslion) {
          // colinear
          centroids.push([centroid, 0]);
        } else {
          const baseNormal = cross.normalize();
          const height = averagePoint.clone().sub(v2).dot(baseNormal);
          const volume = (baseArea * height) / 3;
          centroids.push([centroid, volume]);
        }
      }
    }

    const centroidVolume = centroids.reduce(
      (acc, cV) => [acc[0].add(cV[0].multiplyScalar(cV[1])), acc[1] + cV[1]],
      [new THREE.Vector3(), 0]
    );
    centroidVolume[0].multiplyScalar(1 / centroidVolume[1]);
    return centroidVolume;
  }

  constructor(facesVertices) {
    this.vertices = [];
    this.edgeMap = new Map();

    for (const face of facesVertices) {
      const vIndices = [];
      for (const vertex of face) {
        let index = this.addNormalizedVertex(vertex);
        vIndices.push(index);
      }
      this.addFace(vIndices);
    }

    //this.removeInnerEdges();
    //this.removeColinearPoints();

    this.checkDuplicatePoints("Constructor");
    this.validate("Constructor");
    //this.validateNoColinear("Constructor");

    const cV = this.calculateCentroid();

    this.centerOfMass = cV[0];
    this.volume = cV[1];
  }

  validatePrev(validationName) {
    let missingPrev = this.getEdges().filter((e) => e.prev === null);
    if (missingPrev.length > 0) {
      console.log(validationName, this);
      console.log(validationName, "Missing prev:", missingPrev);
      throw new Error("Missing prev");
    }
  }

  validateNext(validationName) {
    let missingNext = this.getEdges().filter((e) => e.next === null);
    if (missingNext.length > 0) {
      console.log(validationName, this);
      console.log(validationName, "Missing next:", missingNext);
      throw new Error("Missing next");
    }
  }

  validateNoColinear(validationName) {
    const eLength = this.getEdges().map((e) => {
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
    let missingNext = this.getEdges().filter((e) => e.next === null);
    let missingPrev = this.getEdges().filter((e) => e.prev === null);
    let missingTwin = this.getEdges().filter((e) => e.twin === null);
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
    this.getEdges()
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

    const it = new DebugIterator(100000);
    while (vIndices.length) {
      it.tick();
      const loop = [];
      let mNextV = vIndices[0];

      const it2 = new DebugIterator(100000);
      while (mNextV !== undefined) {
        it2.tick();
        loop.push(mNextV);
        vIndices.splice(vIndices.indexOf(mNextV), 1);
        mNextV = this.getEdges(mNextV, undefined)
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

    const it3 = new DebugIterator(100000);
    while (loops.length) {
      it3.tick();
      const loop = loops.pop();
      for (let i = 0; i < loop.length; i++) {
        const start = loop[i];
        const end = loop[(i + 1) % loop.length];
        // find the face containing both start and end
        const edge = this.getEdge(start, end);
        const face = this.getEdges(start, undefined)
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
      this.getEdges().filter(
        (e) =>
          plane.onPlane(this.getVertex(e.start)) &&
          plane.onPlane(this.getVertex(e.end))
      )
    );
    if (edges.length < 3) {
      return;
    }

    const chains = [];
    const it = new DebugIterator(100000);
    while (edges.length) {
      it.tick();
      const chain = [];
      let mNextE = edges[0];
      const it2 = new DebugIterator(100000);
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
        const it = new DebugIterator(100000);
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
    const edges = this.getEdges();
    const clusters = [];
    const it = new DebugIterator(100000);
    while (edges.length) {
      it.tick();
      const queue = [edges[0]];
      let cluster = [];

      const it2 = new DebugIterator(1000000);
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
      const it = new DebugIterator(100000);
      while (cluster.length) {
        it.tick();
        let edge = cluster[0];
        const face = [];
        const it2 = new DebugIterator(100000);
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

  margin(plane) {
    const distances = this.vertices.map((v) => plane.signedDistance(v));

    const posDistance = distances
      .filter((v) => v >= 0)
      .reduce((dist, acc) => Math.max(acc, dist), -100);
    const negDistance = distances
      .filter((v) => v <= 0)
      .reduce((dist, acc) => Math.min(acc, dist), 100);

    return Math.min(-negDistance, posDistance);
  }

  cut(plane, marginThreshold = 0.0) {
    if (this.margin(plane) < marginThreshold) {
      return;
    }
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
    for (let edge of this.getEdges()) {
      if (traversedEdges.includes(edge)) {
        continue;
      }
      traversedEdges.push(edge);
      var next = edge.next;
      // This does not handle colinear edges at all.
      const it = new DebugIterator(100000);
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

const geoToDecl = (geometry, onCut) => {
  const indices = geometry.index;
  const positions = geometry.attributes.position;
  const v = new THREE.Vector3();
  var facesVertices = [];
  if (!indices) {
    for (let i = 0; i < positions.count; i += 3) {
      facesVertices.push([
        v.fromBufferAttribute(positions, i).clone(),
        v.fromBufferAttribute(positions, i + 1).clone(),
        v.fromBufferAttribute(positions, i + 2).clone(),
      ]);
    }
  } else {
    for (let i = 0; i < indices.count; i += 3) {
      facesVertices.push([
        v.fromBufferAttribute(positions, indices.array[i]).clone(),
        v.fromBufferAttribute(positions, indices.array[i + 1]).clone(),
        v.fromBufferAttribute(positions, indices.array[i + 2]).clone(),
      ]);
    }
  }

  const decl = new DcelMesh(facesVertices);
  const b = decl.break();
  const decls = b ? b.map((faces) => new DcelMesh(faces)) : [decl];

  const meshes = [];
  for (const d of decls) {
    const average = d.centerOfMass.clone();
    d.vertices.forEach((v) => v.sub(average));
    d.centerOfMass.sub(average);
    d.targetPos = average;
    average.multiplyScalar(1.1);
    const m = makeMesh(d, average, onCut);
    m.offset = average;
    meshes.push(m);
  }
  return meshes;
};

const randomGeo = () => {
  const rand = Math.random();
  switch (Math.floor(rand * 4)) {
    default:
    case 0:
      return new THREE.BoxGeometry();
    case 1:
      return new THREE.CylinderGeometry();
    case 2:
      return new THREE.TetrahedronGeometry();
    case 3:
      return new THREE.SphereGeometry();
  }
};

class GameRules {
  constructor() {
    this.state = "StartMenu";
  }
}

const rules = {
  state: "START",
};

class StartChallenge {
  constructor(startingVolume, portions, margin) {
    this.startingVolume = startingVolume;
    this.portions = portions;
    this.margin = margin;
  }
}

class PortioningChallenge {
  constructor(startingVolume, portions, margin) {
    this.startingVolume = startingVolume;
    this.portions = portions;
    this.margin = margin;
  }
}

const portioningChallenge = () => {
  const geo = randomGeo();
  const meshes = geoToDecl(geo, dissolveThresholdCut(0.4));
  const volume = meshes[0].decl.volume;
  const challenge = new PortioningChallenge(
    volume,
    [volume / 2, volume / 2],
    volume / 10
  );
  meshes[0].onCut = dissolveThresholdCut(volume / 50);
};

class PieceChallenge {
  constructor(startingVolume, minVolume) {
    this.startingVolume = startingVolume;
    this.minVolume = minVolume;
  }
}

const triggerPieceChallenge = () => {
  const geo = randomGeo();
  const meshes = geoToDecl(geo, dissolveThresholdCut(0.4));
  const volume = meshes[0].decl.volume;
  const challenge = new PieceChallenge(volume, volume / 7);
  meshes[0].onCut = dissolveThresholdCut(volume / 50);
};

const gameState = {
  pieceChallenges: 0,
  portionChallenges: 0,
};

const dissolveThresholdCut = (threshold) => {
  return (oldMesh, newMesh, cutPlane) => {
    let cutNormal = cutPlane.worldLookAt();
    cutNormal.z = 0;
    const newOffset = newMesh.offset;
    const newVolume = newMesh.decl.volume;
    const oldTarget = oldMesh.decl.targetPos;
    const cutEnough = newVolume < threshold;
    const dir = Math.sign(newOffset.dot(cutNormal));
    const newTarget = oldTarget
      .clone()
      .add(newOffset)
      .add(cutNormal.normalize().multiplyScalar(0.1 * dir));

    if (cutEnough) {
      newMesh.canCut = false;
      newMesh.material.uniforms.uFading.value = true;
    }

    newMesh.decl.targetPos = newTarget;
    gsap.to(newMesh.position, {
      duration: 1.5,
      x: newTarget.x,
      y: newTarget.y,
      z: newTarget.z,
      ease: "elastic.out",
      onComplete: () => {
        if (cutEnough) {
          root.remove(newMesh);
        }
        if (root.children.length === 0) {
          if (gameState.pieceChallenges < 10) {
            triggerPieceChallenge();
            gameState.pieceChallenges++;
          } else {
            portioningChallenge();
            gameState.portioningChallenge++;
          }
        }
      },
    });
  };
};

const makeMesh = (decl, pos, onCut) => {
  const boxG = new THREE.BufferGeometry();
  const vertices = decl.toVertices();
  const verticesArray = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    v.toArray(verticesArray, 3 * i);
  });
  boxG.setAttribute("position", new THREE.BufferAttribute(verticesArray, 3));
  boxG.computeVertexNormals();
  boxG.computeBoundingBox();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    vertexShader: dissolveVertexShader,
    fragmentShader: dissolveFragmentShader,
    uniforms: {
      uMatcap: {
        type: "sampler2D",
        value: matcapTexture,
      },
      uTime: {
        value: timeTracker.elapsedTime,
      },
      uTimeSinceSpawn: {
        value: 0,
      },
      uFading: {
        value: false,
      },
    },
  });

  const mesh = new THREE.Mesh(boxG, material);
  mesh.decl = decl;
  mesh.onCut = onCut;
  mesh.layers.enable(1);
  root.add(mesh);
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.canCut = true;
  return mesh;
};

const cutMesh = (mesh, plane) => {
  if (!mesh.canCut) {
    return;
  }
  mesh.decl.cut(plane);
  const mFaces = mesh.decl.break();
  if (!mFaces) {
    return;
  }
  mouse.lastHit = 0;
  mFaces.forEach((faces) => {
    const decl = new DcelMesh(faces);
    const average = decl.centerOfMass.clone();
    decl.vertices.forEach((v) => v.sub(average));
    decl.centerOfMass.sub(average);
    const m = makeMesh(decl, mesh.position.clone(), mesh.onCut, true);
    if (mesh.onCut) {
      m.offset = average;
      mesh.onCut(mesh, m, cutMe);
    }
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

const allChildren = (object) => {
  const descendants = object.children
    .map((c) => allChildren(c))
    .reduce((children, acc) => acc.concat(children), []);
  return descendants.concat(object.children);
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

  for (const child of allChildren(scene)) {
    const material = child.material;
    if (!material) {
      continue;
    }
    const uniforms = material.uniforms;
    if (!uniforms) {
      continue;
    }
    const uTime = uniforms.uTime;
    if (uTime) {
      uTime.value = timeTracker.elapsedTime;
    }
    const uTimeSinceSpawn = uniforms.uTimeSinceSpawn;
    if (uTimeSinceSpawn) {
      uTimeSinceSpawn.value += timeTracker.deltaTime;
    }
  }
  slashUniforms.uTime.value = timeTracker.elapsedTime;
  mouse.lastHit += timeTracker.deltaTime;

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
  if (mouse.lastHit > -1) {
    rotateRoot(timeTracker.deltaTime);
  }
  // Render scene
  composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  stats.end();
};
initLoadingAnimation();
tick();
