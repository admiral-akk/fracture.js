uniform sampler2D uMatcap;
uniform bool uFading;
uniform float uTimeSinceSpawn;
varying vec4 vNormal;

// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{
   vec2 uv = 0.5 * vNormal.xy + vec2(0.5,0.5);
   vec4 matcapColor = texture2D( uMatcap,uv );
   float alpha = clamp(1. - (float(uFading) * uTimeSinceSpawn), 0.,1.);
   gl_FragColor = vec4(pow(matcapColor.x,0.45),

   pow(matcapColor.y,0.45),pow(matcapColor.z,0.45), alpha);
}