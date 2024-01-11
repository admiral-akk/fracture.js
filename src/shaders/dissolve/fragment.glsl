uniform sampler2D uMatcap;
uniform bool uFading;
uniform float uTimeSinceSpawn;
varying vec3 vNormal;

// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{
   vec2 uv = 0.5 * vNormal.xy + vec2(0.5,0.5);
   vec4 matcapColor = texture2D( uMatcap,uv );
   float alpha = clamp(1. - (float(uFading) * uTimeSinceSpawn), 0.,1.);
   vec3 gammaCorrection = vec3(
      pow(matcapColor.r,0.45),
      pow(matcapColor.g,0.45),
      pow(matcapColor.b,0.45)
   );
   gl_FragColor = vec4(matcapColor.rgb, alpha);
}