export const quad = `#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}`;

const header = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

// Manual periodic bilinear interpolation avoids depending on OES_texture_float_linear.
export const sampleWind = `
uniform sampler2D wind;
vec2 velocity(vec2 p){
  ivec2 n=textureSize(wind,0);vec2 q=fract(p)*vec2(n)-.5;
  ivec2 i=ivec2(floor(q));vec2 f=fract(q);
  ivec2 a=(i%n+n)%n,b=(a+1)%n;
  return mix(mix(texelFetch(wind,a,0).xy,texelFetch(wind,ivec2(b.x,a.y),0).xy,f.x),
    mix(texelFetch(wind,ivec2(a.x,b.y),0).xy,texelFetch(wind,b,0).xy,f.x),f.y);
}`;

export const field = header + `
in vec2 uv;out vec4 color;
uniform float time;uniform int preset;
void main(){
  float tau=6.28318530718;
  vec2 p=uv*tau;float t=time*.0001;vec2 v;
  if(preset==0){v=vec2(22.*sin(p.y+t)*cos(p.x+t*.3)+7.,-18.*cos(p.y+t)*sin(p.x+t*.3));}
  else if(preset==1){float y=sin(p.y+.35*sin(p.x+t));v=vec2(8.+28.*exp(-7.*y*y),7.*cos(p.x+t)*cos(p.y));}
  else{v=vec2(18.,6.);}
  color=vec4(v,0,1);
}`;

export const update = header + `
in vec2 uv;out vec4 color;
uniform sampler2D state;uniform vec2 domain;uniform float dt;uniform float time;uniform int method;
${sampleWind}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec4 s=texelFetch(state,ivec2(gl_FragCoord.xy),0);
  vec2 k=velocity(s.xy)/domain;
  if(method==1)k=velocity(s.xy+.5*dt*k)/domain;
  vec2 p=fract(s.xy+dt*k);float age=s.z+dt;
  if(age>22000.+s.w*18000.){p=vec2(hash(uv+time*.00001),hash(uv.yx+time*.00003));age=0.;}
  color=vec4(p,age,s.w);
}`;

const projection = `
uniform vec2 viewport;uniform vec2 domain;uniform vec2 pan;
uniform float zoom;uniform float tilt;uniform float yaw;
vec2 project(vec2 p){
  vec2 a=(p-.5)*vec2(domain.x/domain.y,1.);
  a=mat2(cos(yaw),sin(yaw),-sin(yaw),cos(yaw))*a;
  a.y*=cos(tilt);
  float perspective=1.+sin(tilt)*((p.y-.5)*.38);
  return (a/perspective)*vec2(viewport.y/viewport.x,1.)*1.55*zoom+pan;
}`;

const palette = `vec3 palette(float s){float t=clamp(s/45.,0.,1.);return t<.35?mix(vec3(.19,.43,.80),vec3(.22,.78,.86),t/.35):t<.7?mix(vec3(.22,.78,.86),vec3(.44,.93,.72),(t-.35)/.35):mix(vec3(.44,.93,.72),vec3(.95,.77,.39),(t-.7)/.3);}`;

export const particleVertex = header + `
uniform sampler2D state;uniform int side;uniform float pixelRatio;
out vec3 tint;
${sampleWind}${projection}${palette}
void main(){ivec2 i=ivec2(gl_VertexID%side,gl_VertexID/side);vec2 p=texelFetch(state,i,0).xy;
gl_Position=vec4(project(p),0,1);gl_PointSize=1.45*pixelRatio;tint=palette(length(velocity(p)));}`;

export const particleFragment = header + `in vec3 tint;out vec4 color;uniform float opacity;
void main(){float a=1.-smoothstep(.12,.5,length(gl_PointCoord-.5));color=vec4(tint,a*opacity);}`;

export const arrowsVertex = header + `
out vec3 tint;
${sampleWind}${projection}${palette}
void main(){
  int arrow=gl_VertexID/6,part=gl_VertexID%6;
  vec2 p=(vec2(arrow%24,arrow/24)+.5)/vec2(24.,16.);
  vec2 v=velocity(p);vec2 d=v/domain;float len=length(d);
  d=len>0.?d/len:vec2(0.);
  vec2 end=p+d*.014;vec2 normal=vec2(-d.y,d.x);
  vec2 q=part==0?p:part==1||part==2||part==4?end:part==3?end-d*.005+normal*.003:end-d*.005-normal*.003;
  gl_Position=vec4(project(q),0,1);tint=palette(length(v));
}`;
export const arrowsFragment = header + `in vec3 tint;out vec4 color;void main(){color=vec4(tint,.42);}`;

export const fade = header + `in vec2 uv;out vec4 color;uniform sampler2D previous;uniform float retention;
void main(){color=floor(texture(previous,uv)*retention*255.)/255.;}`;

export const composite = header + `
in vec2 uv;out vec4 color;uniform sampler2D trails;uniform vec2 resolution;
void main(){
  vec2 pixel=uv*resolution;
  vec2 line=abs(fract(pixel/70.-.5)-.5)/fwidth(pixel/70.);
  float grid=1.-min(min(line.x,line.y),1.);
  float glow=exp(-length((uv-vec2(.50,.48))*vec2(1.,.8))*3.);
  vec3 bg=vec3(.025,.052,.085)+vec3(.007,.023,.032)*glow+grid*vec3(.014,.026,.035);
  vec4 trail=texture(trails,uv);color=vec4(bg+trail.rgb,1.);
}`;
