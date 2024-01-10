uniform sampler2D tDiffuse;
uniform vec2 uStart;
uniform vec2 uEnd;
varying vec2 vUv;
varying float vAnimationTime;
void main()
{
	vec4 texel = texture2D( tDiffuse, vUv );
   vec2 dUv = vUv - uStart;
   vec2 dLine = uEnd-uStart;
   vec2 dLineNorm = normalize(dLine);
   float t = dot(dUv, dLineNorm) ;
   vec2 orthogonal = dUv - dot(dUv, dLineNorm) *  dLineNorm;
   float tFactor = 1.1;
   float tightness = 150.;
   float distance = length(orthogonal);
   float falloff = 1. - (tightness*distance - tFactor*abs(t - 0.5)) ;
   float distanceToLine = clamp(falloff,0.,1.);

   float animationFade = clamp(1.2* exp(1.-6.*(vAnimationTime)+0.3*t) - 0.1,0.,1.);
   float animationDelay =step(t, 15.*vAnimationTime);   
   float alpha = animationFade * distanceToLine * animationDelay;
   gl_FragColor = alpha*vec4(1.) + (1.-alpha)* texel;
}