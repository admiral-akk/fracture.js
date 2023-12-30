uniform vec2 uStart;
uniform vec2 uEnd;
uniform float uAnimationTime;
varying vec2 vUv;
void main()
{
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

   float animationFade = clamp(1.2* exp(1.-6.*(uAnimationTime)+0.3*t) - 0.1,0.,1.);
   float animationDelay =step(t, 15.*uAnimationTime);   
   gl_FragColor = vec4(1.,1., 1., animationFade * distanceToLine * animationDelay);
}