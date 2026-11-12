(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const edition = document.documentElement.dataset.edition;
  const mapEntry = new URLSearchParams(location.search).get('view') === 'map';
  function panelSrc(id, highResolution = false) {
    return 'assets/' + id + (highResolution ? '-hd' : '') + '.webp?v=' + encodeURIComponent(edition);
  }
  const pages = [
    {title: '封面', panels: ['front-1']},
    {title: '治疗导航地图', panels: ['front-2','front-3']},
    {title: '肺癌脑转移病例', panels: ['back-2']},
    {title: '胰腺癌肝转移病例', panels: ['back-3']},
    {title: '封底', panels: ['back-1']}
  ];
  const reader = byId('reader'), viewport = byId('reader-viewport'), images = byId('page-images');
  const stepButtons = Array.from(document.querySelectorAll('[data-step]'));
  let foldState = {side:'front',step:0,moving:false};
  let pageIndex = 0, magnification = 1, baseWidth = 1, fitWidth = 1;
  let lastFocus, layoutFrame, lastStamp = 0, lastPoint = null;
  const pointers = new Map();
  let drag = null, pinch = null;
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const panelRatio = 840.6 / 1188;
  const stageNames = ['合上','半展开','全展开'];

  function syncFold(next) {
    foldState = next;
    byId('read-label').textContent = next.side === 'front' ? '查看内页' : '逐页阅读';
    stepButtons.forEach((b,i) => b.setAttribute('aria-pressed',String(i===next.step)));
    if (!next.moving) {
      const description = stageNames[next.step]+'，'+(next.side==='front'?'正面':'背面');
      if (byId('announce').textContent !== description) byId('announce').textContent = description;
    }
  }
  function resetPointers(){pointers.clear();drag=null;pinch=null;lastStamp=0;viewport.classList.remove('is-panning');}
  function layout() {
    const count=pages[pageIndex].panels.length, gutter=viewport.clientWidth<650?16:40;
    const availableW=Math.max(64, viewport.clientWidth-gutter);
    const availableH=Math.max(64, viewport.clientHeight-24);
    const heightFit=availableH*panelRatio;
    fitWidth=Math.min(availableW/count,heightFit);
    baseWidth=viewport.clientWidth<650 ? Math.min(availableW,heightFit) : fitWidth;
    const w=baseWidth*count*magnification, h=baseWidth*magnification/panelRatio;
    images.style.width=w+'px';images.style.height=h+'px';
    images.style.setProperty('--top',Math.max(10,(viewport.clientHeight-h)/2)+'px');
    byId('zoom').textContent=Math.round(100*magnification)+'%';
    byId('smaller').disabled=magnification<=minZoom()+.001;
    byId('larger').disabled=magnification>=4-.001;
  }
  function minZoom(){return Math.min(1,fitWidth/baseWidth);}
  function layoutAround(value,cx,cy) {
    const rect=images.getBoundingClientRect();
    const fx=(cx-rect.left)/rect.width, fy=(cy-rect.top)/rect.height;
    magnification=clamp(value,minZoom(),4);layout();
    const after=images.getBoundingClientRect();
    viewport.scrollLeft+=after.left+after.width*fx-cx;
    viewport.scrollTop+=after.top+after.height*fy-cy;
  }
  function zoomBy(factor){
    const b=viewport.getBoundingClientRect();
    layoutAround(magnification*factor,b.left+b.width/2,b.top+b.height/2);
  }
  function showPage(index, part=0) {
    pageIndex=clamp(index,0,pages.length-1);magnification=1;resetPointers();
    const page=pages[pageIndex];byId('reader-title').textContent=page.title;
    byId('count').textContent=(pageIndex+1)+' / '+pages.length;
    byId('prev').disabled=pageIndex===0;byId('next').disabled=pageIndex===pages.length-1;
    const fragments=page.panels.map((id,i)=>{
      const img=new Image();img.alt=page.title+(page.panels.length>1?(i?'右半幅':'左半幅'):'');
      img.src=panelSrc(id);img.draggable=false;
      const hd=new Image();
      hd.onload=()=>{if(img.isConnected)img.src=hd.src};hd.src=panelSrc(id,true);
      return img;
    });
    images.replaceChildren(...fragments);layout();
    viewport.scrollLeft=part ? viewport.scrollWidth-viewport.clientWidth : 0;
    viewport.scrollTop=0;
  }
  function openReader(index,part=0){
    if(!reader.open){lastFocus=document.activeElement;reader.showModal();document.body.style.overflow='hidden';}
    showPage(index,part);
    byId('exit-reader').focus({preventScroll:true});
  }
  function openMap() {
    openReader(1);
    magnification = minZoom();
    layout();
    viewport.scrollTo(0,0);
  }
  function selected({side,panel}){
    const asset=side+'-'+panel, index=pages.findIndex(p=>p.panels.includes(asset));
    if(index>=0)openReader(index,pages[index].panels.indexOf(asset));
  }
  const paper=window.createTrifold?.(byId('paper'),{initialStep:mapEntry?2:0,onChange:syncFold,onSelect:selected,panelSrc});
  if(!paper){const img=new Image();img.src=panelSrc('front-1');img.alt='打开三折页';img.style.cssText='width:100%;height:100%;object-fit:contain;padding:20px;cursor:pointer';img.onclick=()=>openReader(0);byId('paper').appendChild(img);byId('flip').disabled=true;stepButtons.forEach(b=>b.disabled=true);}
  stepButtons.forEach((b,i)=>b.addEventListener('click',()=>paper?.setStep(i)));
  byId('flip').addEventListener('click',()=>paper?.flip());
  byId('read').addEventListener('click',()=>{
    if (foldState.side === 'front') {
      openMap();
    } else {
      openReader(foldState.step === 0 ? 4 : 2);
    }
  });
  if (mapEntry) openMap();
  byId('exit-reader').onclick=()=>reader.close();
  reader.addEventListener('close',()=>{
    resetPointers();document.body.style.overflow='';
    (lastFocus && lastFocus!==document.body?lastFocus:byId('read')).focus({preventScroll:true});
  });
  byId('prev').onclick=()=>showPage(pageIndex-1);
  byId('next').onclick=()=>showPage(pageIndex+1);
  byId('smaller').onclick=()=>zoomBy(1/1.45);
  byId('larger').onclick=()=>zoomBy(1.45);
  byId('zoom').onclick=()=>{magnification=minZoom();layout();viewport.scrollTo(0,0);};
  viewport.addEventListener('wheel',e=>{
    if(!e.ctrlKey&&!e.metaKey)return;
    e.preventDefault();layoutAround(magnification*Math.exp(-e.deltaY*.012),e.clientX,e.clientY);
  },{passive:false});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  function beginDrag(p,moved=false){drag={p, sx:viewport.scrollLeft,sy:viewport.scrollTop,moved};}
  viewport.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.pointerType==='mouse')return;
    const p={x:e.clientX,y:e.clientY};pointers.set(e.pointerId,p);
    viewport.setPointerCapture(e.pointerId);
    if(pointers.size===1)beginDrag(p);
    else if(pointers.size===2){
      const [a,b]=pointers.values(),mid=midpoint(a,b),r=images.getBoundingClientRect();
      pinch={scale:magnification, dist:Math.max(1,distance(a,b)),fx:(mid.x-r.left)/r.width,fy:(mid.y-r.top)/r.height};
      drag=null;lastStamp=0;
    }
  });
  viewport.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    const p={x:e.clientX,y:e.clientY};pointers.set(e.pointerId,p);
    if(pinch&&pointers.size>=2){
      const [a,b]=pointers.values(),m=midpoint(a,b);
      magnification=clamp(pinch.scale*distance(a,b)/pinch.dist,minZoom(),4);layout();
      const r=images.getBoundingClientRect();viewport.scrollLeft+=r.left+pinch.fx*r.width-m.x;viewport.scrollTop+=r.top+pinch.fy*r.height-m.y;
    }else if(drag){
      if(distance(drag.p,p)>5){drag.moved=true;viewport.classList.add('is-panning');}
      if(drag.moved){viewport.scrollLeft=drag.sx+drag.p.x-p.x;viewport.scrollTop=drag.sy+drag.p.y-p.y;}
    }
  });
  function stopPointer(e){
    if(!pointers.has(e.pointerId))return;
    const cur=pointers.get(e.pointerId);pointers.delete(e.pointerId);
    if(e.type==='pointerup'&&drag&&!drag.moved&&!pinch){
      const now=performance.now();
      if(lastStamp && now-lastStamp<330 && lastPoint && distance(lastPoint,cur)<30){
        layoutAround(magnification>1.1?1:2,cur.x,cur.y);lastStamp=0;
      }else{lastStamp=now;lastPoint=cur;}
    }
    if(pointers.size<2)pinch=null;
    if(pointers.size===1)beginDrag([...pointers.values()][0],true);
    if(!pointers.size){drag=null;viewport.classList.remove('is-panning');}
  }
  viewport.addEventListener('pointerup',stopPointer);viewport.addEventListener('pointercancel',stopPointer);
  window.addEventListener('resize',()=>{
    if(!reader.open)return;
    cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{layout();});
  });
  document.addEventListener('keydown',e=>{
    if(e.altKey||e.ctrlKey||e.metaKey)return;
    if(reader.open){
      if(e.key==='ArrowLeft' && pageIndex>0){e.preventDefault();showPage(pageIndex-1);}
      else if(e.key==='ArrowRight' && pageIndex<pages.length-1){e.preventDefault();showPage(pageIndex+1);}
      else if(e.key==='+'||e.key==='='){e.preventDefault();zoomBy(1.45);}
      else if(e.key==='-'){e.preventDefault();zoomBy(1/1.45);}
    }else if(!e.defaultPrevented&&!(e.target instanceof HTMLInputElement)){
      if(e.key==='ArrowLeft'){e.preventDefault();paper?.setStep(Math.max(0,foldState.step-1));}
      if(e.key==='ArrowRight'){e.preventDefault();paper?.setStep(Math.min(2,foldState.step+1));}
      if(e.key.toLowerCase()==='f'){e.preventDefault();paper?.flip();}
    }
  });
})();
