/* Freestanding paper viewer. No network, animation or 3D framework is required. */
(function () {
  'use strict';
  const aspect = 1188 / 840.6;
  const rad = Math.PI / 180;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const smooth = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, f) => a.map(v => v * f);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const cross2 = (a, b) => a[0]*b[1] - a[1]*b[0];
  const svgNS = 'http://www.w3.org/2000/svg';
  let serial = 0;
  function svg(tag, attrs, parent) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  }
  function html(tag, cls, parent) {
    const n = document.createElement(tag);
    n.className = cls;
    parent.appendChild(n);
    return n;
  }
  const points = vertices => vertices.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');
  // Clip a convex polygon to the positive side of a line or plane.
  function clip(poly, distance) {
    const result = [];
    for (let j=0; j<poly.length; j++) {
      const a = poly[j], b = poly[(j+1) % poly.length];
      const da=distance(a), db=distance(b);
      if (da >= 0) result.push(a);
      if ((da < 0) !== (db < 0)) result.push(add(a, mul(sub(b, a), da / (da-db))));
    }
    return result;
  }
  function overlap(a, b) {
    let poly = a.corners;
    const dir = b.recto ? 1 : -1;
    for (let j=0; j<4 && poly.length; j++) {
      const start=b.corners[j], edge=sub(b.corners[(j+1)%4],start);
      poly = clip(poly, p => dir * cross2(edge, sub(p, start)));
    }
    return poly;
  }
  function createTrifold(container, options) {
    options = options || {};
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw Error('找不到三折页容器');
    if (container.trifoldPaper) return container.trifoldPaper;
    const instanceId = 'fold-paper-' + (++serial);
    const root = html('div','trifold-paper',container);
    root.style.width = '100%'; root.style.height = '100%';
    root.tabIndex=0; root.setAttribute('role','group'); root.setAttribute('aria-label','三折页。横向拖动开合，左右方向键切换折叠状态，F 键翻面。');
    const floor=svg('svg',{class:'fp-floor','aria-hidden':'true'},root);
    const defs=svg('defs',{},floor);
    const blurId=instanceId+'-floor';
    const blur=svg('filter',{id:blurId,x:'-40%',y:'-50%',width:'190%',height:'220%',colorInterpolationFilters:'sRGB'},defs);
    const blurLevel=svg('feGaussianBlur',{stdDeviation:4},blur);
    const shadows=svg('g',{filter:'url(#'+blurId+')',fill:'#35382e',opacity:'.19'},floor);
    const scene=html('div','fp-scene',root);scene.setAttribute('aria-hidden','true');
    const edges=svg('svg',{class:'fp-profiles','aria-hidden':'true'},root);
    const sourceRoot=(options.assetPath || 'assets').replace(/\/$/,'');
    const leaves = Array.from({length:3},(_,i)=>{
      const leaf=html('div','fp-leaf',scene);
      leaf.dataset.paperPanel=String(i+1);
      const faces=['front','back'].map((side,sideIndex)=>{
        const index=side==='front'?i+1:3-i;
        const img=html('img','fp-print'+(sideIndex?' fp-verso':''),leaf);
        img.alt=''; img.draggable=false;img.decoding='async';
        img.src=options.panelSrc ? options.panelSrc(side+'-'+index) : sourceRoot+'/'+side+'-'+index+'.webp';
        return img;
      });
      const light=html('div','fp-light',leaf);
      const cast=svg('svg',{class:'fp-cast',viewBox:'0 0 1000 '+(aspect*1000),'preserveAspectRatio':'none'},leaf);
      const projected=[0,1,2].map(()=>svg('polygon',{fill:'#42423c',opacity:0},cast));
      const crease=html('div','fp-creases',leaf);
      const shadow=svg('polygon',{fill:'#353932'},shadows);
      const edge=svg('polyline',{fill:'none',stroke:'#7c817c','stroke-width':'1'},edges);
      return {leaf,faces,light,projected,crease,shadow,edge};
    });
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced=media.matches;
    let width=0,height=0,geometry=[],frame=0,previousTime=0,drag=null;
    let step=clamp(Math.round(Number(options.initialStep)||0),0,2);
    let progress=step, velocity=0;
    let side=options.initialSide==='back'?'back':'front';
    let yaw=side==='back'?Math.PI:0, yawGoal=yaw,yawVelocity=0;
    let moving=false,dead=false,lastReport=0;
    let center=[0,0],camera=1000;
    const listeners=[];
    function listen(node,name,cb,opt){node.addEventListener(name,cb,opt);listeners.push(()=>node.removeEventListener(name,cb,opt));}
    function state(){return {step,side,progress,moving,turn:yaw/Math.PI,dragging:!!(drag&&drag.started)};}
    function announce(force){
      const now=performance.now();
      if(force||now-lastReport>=40){lastReport=now;if(options.onChange)options.onChange(state());}
    }
    function project(p) {
      const scale=camera/(camera-p[2]);return [center[0]+p[0]*scale,center[1]+p[1]*scale];
    }
    function depthAt(g,p){
      const ray=[(p[0]-center[0])/camera,(p[1]-center[1])/camera,-1];
      const d=dot(g.normal,ray);
      if(Math.abs(d)<1e-8)return g.meanZ;
      const t=dot(g.normal,sub(g.world[0],[0,0,camera]))/d;
      return camera-t;
    }
    function stackOrder(){
      const near=[[],[],[]];
      for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){
        const a=geometry[i], b=geometry[j],common=overlap(a,b);
        if(common.length<3)continue;
        const pt=mul(common.reduce((s,v)=>add(s,v),[0,0]),1/common.length);
        const delta=depthAt(a,pt)-depthAt(b,pt);
        if(Math.abs(delta)>.02) near[delta>0?j:i].push(delta>0?i:j);
      }
      const ordered=[];
      while(ordered.length<3){
        const left=[0,1,2].filter(i=>!ordered.includes(i));
        const free=left.filter(i=>!left.some(j=>near[j].includes(i)));
        const rest=free.length?free:left;rest.sort((a,b)=>geometry[a].meanZ-geometry[b].meanZ);
        ordered.push(rest[0]);
      }
      return ordered;
    }
    function draw(){
      if(!width||!height||dead)return;
      const t=clamp(progress/2,0,1);
      // The accordion has alternate valley/mountain folds. A small closed angle leaves room for paper stock.
      const a=178.4*rad*(1-smooth(t/.86));
      const b=-178.4*rad*(1-smooth((t-.14)/.86));
      const axes=[0,a,a+b].map(v=>[Math.cos(v),0,-Math.sin(v)]);
      const starts=[[0,-aspect/2,0]];
      starts.push(add(starts[0],axes[0])); starts.push(add(starts[1],axes[1]));
      const xz=[...starts,add(starts[2],axes[2])];
      const xs=xz.map(p=>p[0]), zs=xz.map(p=>p[2]);
      const xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs);
      const pivot=[(xmin+xmax)/2,0,(zmin+zmax)/2];
      const fittingWidth=Math.hypot(xmax-xmin,zmax-zmin);
      const padX=width<520?Math.max(12,width*.041):Math.max(30,width*.05);
      const padY=height<470?Math.max(15,height*.054):Math.max(27,height*.072);
      const s=Math.max(1,Math.min((width-2*padX)/(fittingWidth+.045),(height-2*padY)/(aspect+.085)));
      camera=Math.max(600,s*4.9,width*.95);
      const tiltY=yaw+6*rad*(1-t), pitch=-(1-t)*5*rad, roll=-(1-t)*2.0*rad;
      const cy=Math.cos(tiltY),sy=Math.sin(tiltY),cx=Math.cos(pitch),sx=Math.sin(pitch),cz=Math.cos(roll),sz=Math.sin(roll);
      function rotate(v){
        const x=cy*v[0]+sy*v[2],z=-sy*v[0]+cy*v[2],y=cx*v[1]-sx*z;
        return [cz*x-sz*y,sz*x+cz*y,sx*v[1]+cx*z];
      }
      const vAxis=rotate([0,1,0]);
      const heightPx=s*aspect;
      geometry=leaves.map((leaf,i)=>{
        const u=rotate(axes[i]),origin=mul(rotate(sub(starts[i],pivot)),s);
        const ex=mul(u,s),ey=mul(vAxis,heightPx);
        const world=[origin,add(origin,ex),add(add(origin,ex),ey),add(origin,ey)];
        return {u,v:vAxis,normal:cross(u,vAxis),world,meanZ:world.reduce((n,p)=>n+p[2]/4,0)};
      });
      center=[0,0];
      const all=geometry.flatMap(g=>g.world);
      const projected=all.map(project);
      const px=projected.map(p=>p[0]), py=projected.map(p=>p[1]);
      center=[width/2-(Math.max(...px)+Math.min(...px))/2,height/2-(Math.max(...py)+Math.min(...py))/2-2];
      geometry.forEach(g=>{
        g.corners=g.world.map(project);
        g.recto=cross2(sub(g.corners[1],g.corners[0]),sub(g.corners[3],g.corners[0]))>=0;
      });
      const sorted=stackOrder();
      const ground=Math.min(...all.map(p=>p[2]))-s*.028;
      const sun=[-.38,-.76,.92];
      blurLevel.setAttribute('stdDeviation',String(clamp(s*.025,2.8,9.5)));
      geometry.forEach((g,i)=>{
        const dom=leaves[i],o=g.world[0],u=g.u,v=g.v,n=g.normal;
        const wx=-u[2]/camera,wy=-v[2]/camera,w0=1-o[2]/camera;
        const pair=(ax,coeff,k)=>ax[k]+center[k]*coeff;
        const mat=[pair(u,wx,0),pair(u,wx,1),0,wx,pair(v,wy,0),pair(v,wy,1),0,wy,0,0,1,0,
          o[0]+center[0]*w0,o[1]+center[1]*w0,0,w0];
        dom.leaf.style.width=s+'px';dom.leaf.style.height=heightPx+'px';
        dom.leaf.style.transform='matrix3d('+mat.map(k=>k.toFixed(10)).join(',')+')';
        dom.leaf.style.zIndex=String(sorted.indexOf(i)+1);
        dom.faces[0].hidden=!g.recto;dom.faces[1].hidden=g.recto;
        const faceNormal=g.recto?n:mul(n,-1);
        const lighting=clamp(.91-dot(faceNormal,sun),0,1);
        dom.light.style.opacity=String(.009+.26*lighting);
        dom.crease.style.setProperty('--fold-left',i===0?'0':String(.022+.11*(i===1?Math.abs(a):Math.abs(b))/Math.PI));
        dom.crease.style.setProperty('--fold-right',i===2?'0':String(.022+.11*(i===0?Math.abs(a):Math.abs(b))/Math.PI));
        const castOnFloor=g.world.map(p=>{
          const dz=p[2]-ground;return project([p[0]+dz*.23+1,p[1]+dz*.34+2,ground]);
        });
        dom.shadow.setAttribute('points',points(castOnFloor));
        const alignment=Math.abs(n[2]);
        dom.edge.setAttribute('points',points([...g.corners,g.corners[0]]));
        dom.edge.style.opacity=alignment<.065?String((.065-alignment)/.065*.9):'0';
        geometry.forEach((caster,j)=>{
          const shadow=dom.projected[j],den=dot(n,sun);
          if(i===j||Math.abs(den)<.045||dot(faceNormal,sun)<.1){shadow.style.opacity='0';return;}
          const dist=p=>dot(n,sub(p,o))/den;
          const forward=clip(caster.world,p=>dist(p)-.05);
          if(forward.length<3){shadow.style.opacity='0';return;}
          const projected=forward.map(p=>{
            const local=sub(sub(p,mul(sun,dist(p))),o);return [dot(local,u)*1000/s,dot(local,v)*1000/s];
          });
          shadow.setAttribute('points',points(projected));
          shadow.style.opacity=String(.13*Math.min(1,Math.abs(den)*2));
        });
      });
    }
    function panelAt(clientX,clientY){
      const rect=root.getBoundingClientRect(),p=[clientX-rect.left,clientY-rect.top];
      const hits=geometry.flatMap((g,i)=>{
        const sign=g.recto?1:-1;
        const inside=g.corners.every((a,j)=>sign*cross2(sub(g.corners[(j+1)%4],a),sub(p,a))>=-.02);
        return inside?[{side:g.recto?'front':'back',panel:g.recto?i+1:3-i,z:depthAt(g,p)}]:[];
      }).sort((a,b)=>b.z-a.z);
      return hits.length?{side:hits[0].side,panel:hits[0].panel}:null;
    }
    function queue(){
      if(dead||frame)return;
      frame=requestAnimationFrame(tick);
    }
    function start(){moving=true;announce(true);queue();}
    // Semi-implicit spring integration uses small steps, independent of display refresh rate.
    function tick(time){
      frame=0;if(dead)return;
      const dt=previousTime?Math.min(.048,(time-previousTime)/1000):1/60;previousTime=time;
      if(reduced){if(!(drag&&drag.started))progress=step;yaw=yawGoal;velocity=yawVelocity=0;}
      else {
        const count=Math.max(1,Math.ceil(dt*120)),h=dt/count;
        for(let i=0;i<count;i++){
          if(!(drag&&drag.started)){
            velocity+=((step-progress)*165-24*velocity)*h;progress+=velocity*h;
            if(progress<0||progress>2){progress=clamp(progress,0,2);velocity=0;}
          }
          yawVelocity+=((yawGoal-yaw)*88-17*yawVelocity)*h;yaw+=yawVelocity*h;
        }
      }
      const unsettled=Math.abs(progress-step)>.0004||Math.abs(velocity)>.008||Math.abs(yaw-yawGoal)>.0004||Math.abs(yawVelocity)>.009;
      const pulling=!!(drag&&drag.started);
      moving=pulling||unsettled;
      if(!moving){progress=step;yaw=yawGoal;velocity=yawVelocity=0;previousTime=0;}
      draw();announce(!moving);
      if(unsettled&&!pulling)queue();
    }
    function cancelDrag(){
      if(drag){const id=drag.id;drag=null;root.classList.remove('is-pulling');try{root.releasePointerCapture(id);}catch(e){}}
    }
    function setStep(value){
      if(!Number.isFinite(Number(value)))return;
      cancelDrag();step=clamp(Math.round(Number(value)),0,2);start();
    }
    function setSide(value){
      if(value!=='front'&&value!=='back')return;
      cancelDrag();side=value;yawGoal=side==='back'?Math.PI:0;start();
    }
    function flip(){setSide(side==='front'?'back':'front');}
    listen(root,'pointerdown',e=>{
      if(drag||!e.isPrimary||e.button!==0)return;
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,p:progress,last:progress,time:performance.now(),speed:0,started:false,sign:0};
    });
    listen(root,'pointermove',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!drag.started){
        if(Math.abs(dy)>9&&Math.abs(dy)>Math.abs(dx)*1.15){cancelDrag();return;}
        if(Math.abs(dx)<6)return;
        drag.started=true;root.classList.add('is-pulling');root.setPointerCapture(e.pointerId);
        drag.sign=drag.p<.10?Math.sign(dx):drag.p>1.90?-Math.sign(dx):(side==='front'?-1:1);
      }
      if(e.cancelable)e.preventDefault();
      const sensitivity=clamp(width*.36,105,220);
      progress=clamp(drag.p+(dx*drag.sign)/sensitivity,0,2);
      const now=performance.now(),dt=Math.max(.001,(now-drag.time)/1000);
      drag.speed=clamp(.55*drag.speed+.45*(progress-drag.last)/dt,-6,6);
      drag.time=now;drag.last=progress;velocity=0;moving=true;queue();announce(false);
    });
    function release(e,cancelled){
      if(!drag||e.pointerId!==drag.id)return;
      const pull=drag,travel=Math.hypot(e.clientX-pull.x,e.clientY-pull.y);
      cancelDrag();
      if(pull.started){
        const speed=!cancelled&&performance.now()-pull.time<120?pull.speed:0;
        const displacement=progress-pull.p;
        let dest=Math.round(clamp(progress+speed*.12,0,2));
        if(!cancelled&&Math.abs(displacement)>.17&&dest===Math.round(pull.p))
          dest=clamp(Math.round(pull.p)+Math.sign(displacement),0,2);
        step=dest;velocity=reduced?0:speed;start();
      }else if(!cancelled&&travel<9){
        const hit=panelAt(e.clientX,e.clientY);
        if(hit&&options.onSelect)options.onSelect(hit);
      }
    }
    listen(root,'pointerup',e=>release(e,false));listen(root,'pointercancel',e=>release(e,true));
    listen(root,'pointerleave',()=>{if(drag&&!drag.started)cancelDrag();});
    listen(root,'lostpointercapture',()=>{if(drag&&drag.started){cancelDrag();setStep(Math.round(progress));}});
    listen(root,'keydown',e=>{
      if(e.key==='ArrowRight')setStep(step+1);else if(e.key==='ArrowLeft')setStep(step-1);
      else if(e.key==='Home')setStep(0);else if(e.key==='End')setStep(2);
      else if(e.key.toLowerCase()==='f')flip();else if(e.key==='Enter'&&options.onSelect){
        const r=root.getBoundingClientRect();const hit=panelAt(r.left+r.width/2,r.top+r.height/2);if(hit)options.onSelect(hit);
      }else return;
      e.preventDefault();
    });
    function resize(){
      const r=root.getBoundingClientRect();width=r.width;height=r.height;
      floor.setAttribute('viewBox','0 0 '+Math.max(1,width)+' '+Math.max(1,height));
      edges.setAttribute('viewBox','0 0 '+Math.max(1,width)+' '+Math.max(1,height));
      draw();
    }
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
    if(observer)observer.observe(root);else listen(window,'resize',resize);
    function updateMotion(e){reduced=e.matches;if(moving)queue();}
    if(media.addEventListener)listen(media,'change',updateMotion);
    else {media.addListener(updateMotion);listeners.push(()=>media.removeListener(updateMotion));}
    const api={setStep,setSide,flip,getState:state,panelAt,destroy(){
      dead=true;cancelDrag();if(frame)cancelAnimationFrame(frame);
      if(observer)observer.disconnect();listeners.forEach(off=>off());root.remove();delete container.trifoldPaper;
    }};
    container.trifoldPaper=api;
    resize();queue();
    return api;
  }
  window.createTrifold=createTrifold;
})();
