
varying float lineDist;
varying vec4 objectPos;
varying vec4 worldPos;
varying vec4 viewPos;
varying vec4 projectionPos;
varying float lineDist2;

uniform bool mIsDragging;
uniform vec2 mStart;
uniform vec2 mEnd;
uniform vec3 startHit;
uniform vec3 endHit;
uniform vec3 startNormal;
uniform vec3 planePos;
uniform vec3 planeNormal;
uniform float c;

// Transformation described here: https://stackoverflow.com/questions/29879216/preparing-model-view-and-projection-matrices-for-glsl
// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main() {
     objectPos = vec4(position, 1.);
    // Moves it into world space.
     worldPos = modelMatrix * objectPos;
     vec4 objectCenter = modelMatrix * vec4(0.,0.,0.,1.);
     vec3 mean = normalize(endHit.xyz+startHit.xyz - 2.*objectCenter.xyz);
     vec3 crossVec = normalize(cross(endHit.xyz - startHit.xyz, mean.xyz ));
     vec3 deltaWorld = worldPos.xyz - planePos.xyz;
     lineDist2 = dot(deltaWorld, normalize(planeNormal));

    // Applies view (moves it relative to camera position/orientation)
     viewPos = viewMatrix * worldPos;
    // Applies projection (orthographic/perspective)
    projectionPos = projectionMatrix * viewPos;
    gl_Position = projectionPos;
    lineDist = 1.;
}