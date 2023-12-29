
varying vec4 objectPos;
varying vec4 worldPos;
varying vec4 viewPos;
varying vec4 projectionPos;
varying float distToPlane;

// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{
    gl_FragColor = vec4(step(distToPlane, 0.), step(-distToPlane, 0.), 0., 1.);
}