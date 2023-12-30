uniform vec2 uStart;
uniform vec2 uEnd;
uniform float uAnimationTime;
varying vec2 vUv;
void main()
{
    gl_Position =  vec4(position, 1.0);
    vUv = uv;
}