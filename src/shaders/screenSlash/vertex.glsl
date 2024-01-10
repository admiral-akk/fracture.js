uniform vec2 uStart;
uniform vec2 uEnd;
uniform float uTime;
uniform float uSlashTime;
varying vec2 vUv;
varying float vAnimationTime;
void main()
{
   gl_Position =  vec4(position, 1.0);
   vUv = uv;
   vAnimationTime =  uTime-uSlashTime;
}