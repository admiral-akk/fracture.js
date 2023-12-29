
varying vec4 objectPos;
varying vec4 worldPos;
varying vec4 viewPos;
varying vec4 projectionPos;
varying float distToPlane;

uniform vec3 planePos;
uniform vec3 planeNormal;

// Transformation described here: https://stackoverflow.com/questions/29879216/preparing-model-view-and-projection-matrices-for-glsl
// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main() {
     objectPos = vec4(position, 1.);
    // Moves it into world space.
     worldPos = modelMatrix * objectPos;
     vec3 deltaWorld = worldPos.xyz - planePos.xyz;
     distToPlane = dot(deltaWorld, normalize(planeNormal));

    // Applies view (moves it relative to camera position/orientation)
     viewPos = viewMatrix * worldPos;
    // Applies projection (orthographic/perspective)
    projectionPos = projectionMatrix * viewPos;
    gl_Position = projectionPos;
}