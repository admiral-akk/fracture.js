
varying float lineDist;
varying vec4 objectPos;
varying vec4 worldPos;
varying vec4 viewPos;
varying vec4 projectionPos;
varying float lineDist2;

uniform bool mIsDragging;
uniform vec2 mStart;
uniform vec2 mEnd;
uniform float c;
uniform float stepVal;

// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{

    if (c <= 0.) {
   gl_FragColor = objectPos;

    } else if (c <= 1.) {
   gl_FragColor = worldPos;

    } else if (c <= 2.) {
        gl_FragColor = vec4(step(lineDist2, 0.), step(-lineDist2, 0.), 0., 1.);

    } else if (c <= 3.) {
    gl_FragColor = vec4(step(projectionPos.x, stepVal) , step(projectionPos.y, stepVal), 0., 1.);

    } else {
    gl_FragColor = vec4(clamp(lineDist, 0., 1.),clamp(1.-lineDist, 0.,1.),0., 1.);
    }
}