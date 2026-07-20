// Reusable GLSL chunks for the WebGL2 (GPUComputationRenderer) backend.
// Kept in one place so the compute and render shaders stay consistent.

export const GLSL_NOISE = /* glsl */ `
// Ashima Arts 3D simplex noise (public domain / MIT)
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 snoiseVec3(vec3 x){
  return vec3(snoise(x), snoise(x + vec3(123.4, 234.5, 345.6)), snoise(x + vec3(456.7, 567.8, 678.9)));
}
vec3 curlNoise(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 p_x0 = snoiseVec3(p - dx); vec3 p_x1 = snoiseVec3(p + dx);
  vec3 p_y0 = snoiseVec3(p - dy); vec3 p_y1 = snoiseVec3(p + dy);
  vec3 p_z0 = snoiseVec3(p - dz); vec3 p_z1 = snoiseVec3(p + dz);
  float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
  float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
  float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
  return normalize(vec3(x, y, z) / (2.0 * e) + 1e-6);
}
float hash13(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const GLSL_MOTION = /* glsl */ `
// Returns a force vector for the selected motion mode.
vec3 motionForce(vec3 pos, vec3 tgt, float mode, float mscale, float mspeed, float t, float seed) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (mode < 0.5) return vec3(0.0);                                  // none
  else if (mode < 1.5) return curlNoise(pos * mscale + seed + t * mspeed);            // curl
  else if (mode < 2.5) return snoiseVec3(pos * mscale + t * mspeed + seed);           // noise
  else if (mode < 3.5) {                                                              // brownian
    float r1 = hash13(pos * 13.0 + t * mspeed + seed);
    float r2 = hash13(pos * 17.0 + t * mspeed * 1.3 + seed + 5.0);
    float r3 = hash13(pos * 19.0 + t * mspeed * 0.7 + seed + 9.0);
    return (vec3(r1, r2, r3) - 0.5) * 2.0;
  }
  else if (mode < 4.5) return cross(up, pos);                                         // orbital
  else if (mode < 5.5) return vec3(0.0, sin(pos.x * mscale * 4.0 + t * mspeed) , 0.0);// wave
  else if (mode < 6.5) return cross(up, pos) + (-pos) * 0.25;                         // vortex
  else if (mode < 7.5) return vec3(0.0, -1.0, 0.0);                                   // gravity
  else if (mode < 8.5) return -normalize(pos + 1e-5);                                 // attract
  else {                                                                             // explode
    float decay = exp(-t * 0.6);
    return normalize(pos + 1e-5) * decay * 3.0;
  }
}
`;

export const GLSL_COLOR = /* glsl */ `
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 applyColorAdjust(vec3 col, float hueShift, float sat, float bright, float contrast){
  vec3 hsv = rgb2hsv(col);
  hsv.x = fract(hsv.x + hueShift);
  hsv.y = clamp(hsv.y * sat, 0.0, 1.0);
  col = hsv2rgb(hsv);
  col *= bright;
  col = (col - 0.5) * contrast + 0.5;
  return clamp(col, 0.0, 1.0);
}
// mode: 0 solid 1 grad2 2 grad3 3 image 4 position 5 depth 6 velocity 7 rainbow 8 palette
vec3 computeBaseColor(float mode, vec3 imageColor, vec3 pos, vec3 vel, float boundR,
                      vec3 c1, vec3 c2, vec3 c3, float gradRot, float t, float animSpeed){
  float g = clamp((pos.y / (boundR * 2.0)) + 0.5, 0.0, 1.0);
  float gr = radians(gradRot);
  vec2 dir = vec2(cos(gr), sin(gr));
  float proj = clamp((dot(pos.xy, dir) / (boundR * 2.0)) + 0.5, 0.0, 1.0);
  if (mode < 0.5) return c1;
  else if (mode < 1.5) return mix(c1, c2, proj);
  else if (mode < 2.5) return proj < 0.5 ? mix(c1, c2, proj * 2.0) : mix(c2, c3, (proj - 0.5) * 2.0);
  else if (mode < 3.5) return imageColor;
  else if (mode < 4.5) return normalize(abs(pos) + 0.15);
  else if (mode < 5.5) { float d = clamp(pos.z / (boundR) + 0.5, 0.0, 1.0); return mix(c1, c2, d); }
  else if (mode < 6.5) { float sp = clamp(length(vel) * 2.0, 0.0, 1.0); return mix(c1, c2, sp); }
  else if (mode < 7.5) return hsv2rgb(vec3(fract(g + t * animSpeed * 0.1), 0.85, 1.0));
  else { float idx = fract(g + t * animSpeed * 0.05); return mix(c1, mix(c2, c3, idx), idx); }
}
`;
