uniform float uMinY;
uniform float uWidthY;
uniform float uMaxX;
varying vec2 vUv;
void main()
{
   float yDist = distance(vUv.y, 0.5);
   float alpha = float(yDist >= uMinY);
   float isLoading = alpha * float(vUv.x <= uMaxX && yDist <= uMinY + uWidthY);
   gl_FragColor = vec4(isLoading,isLoading, isLoading, alpha);
}