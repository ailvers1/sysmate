'use strict';
const APP_URL='https://script.google.com/macros/s/AKfycbyQjy5N30aaxIEOIpxTH2hgUhXkumoYUV6zSudzOeVlLqw0zMWFmiydq80Qi0JdcS9r/exec';
const el=id=>document.getElementById(id);
let stream=null,generation=0;
let cameraLabels=[],cameraSelection=[];
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
function normalizeCode(value){const code=String(value||'').trim().toUpperCase();return code.length<=80&&/^[A-Z0-9]+(?:-[A-Z0-9]+){2,5}$/.test(code)?code:null;}
function assetUrl(code){const valid=normalizeCode(code);if(!valid)throw new Error('관리번호 형식을 확인해 주세요.');const url=new URL(APP_URL);url.searchParams.set('code',valid);return url.href;}
function message(text){el('message').textContent=text;const footer=el('message').parentElement;if(footer)footer.hidden=!text;}
function stop(){generation++;document.getElementById('focus-marker')?.remove();if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;el('video').srcObject=null;el('video').hidden=true;el('stop').hidden=true;el('start').disabled=false;el('start').hidden=false;}
function cameraError(error){
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy?.allowsFeature&&!policy.allowsFeature('camera'))return '이 페이지가 다른 앱이나 사이트 안에 삽입되어 카메라가 차단되었습니다. 스캔 페이지 주소를 Chrome 또는 삼성 인터넷의 새 탭에서 직접 열어 주세요.';
  if(error.name==='NotAllowedError'||error.name==='SecurityError')return '카메라 권한이 차단되어 있습니다. 브라우저의 이 사이트 권한에서 카메라를 허용하고, 휴대폰 설정에서도 해당 브라우저의 카메라 권한을 확인해 주세요.';
  if(error.name==='NotFoundError')return '사용 가능한 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰에서 열어 주세요.';
  if(error.name==='NotReadableError'||error.name==='AbortError')return '다른 앱에서 카메라를 사용 중일 수 있습니다. 카메라 앱을 닫고 다시 눌러 주세요.';
  return error.message||'카메라를 시작하지 못했습니다. 관리번호로 검색할 수 있습니다.';
}
function focusModes(track){
  try{const modes=track.getCapabilities?.().focusMode;return Array.isArray(modes)?modes:null;}catch{return null;}
}
function supportsAutoFocus(track){
  return (focusModes(track)||[]).some(mode=>mode==='continuous'||mode==='single-shot');
}
function cameraRequest(video,run,timeoutMs=0){
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    if(timeoutMs)timer=setTimeout(()=>{settled=true;reject(new DOMException('Camera start timeout','TimeoutError'));},timeoutMs);
    navigator.mediaDevices.getUserMedia({audio:false,video}).then(candidate=>{
      if(settled||run!==generation){
        candidate.getTracks().forEach(t=>t.stop());
        if(!settled){settled=true;clearTimeout(timer);reject(new DOMException('Camera cancelled','AbortError'));}
        return;
      }
      settled=true;clearTimeout(timer);resolve(candidate);
    },error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
  });
}
async function acquireCamera(run){
  cameraSelection=[];
  const video={facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}};
  let candidate;
  try{candidate=await cameraRequest(video,run);}
  catch(error){if(error.name!=='OverconstrainedError')throw error;candidate=await cameraRequest({facingMode:{ideal:'environment'}},run);}
  const initialTrack=candidate.getVideoTracks()[0],modes=focusModes(initialTrack);
  cameraSelection.push((initialTrack.label||'기본 후면')+': '+(modes?.join('/')||'초점 정보 미제공'));
  let devices=[];
  try{
    if(navigator.mediaDevices.enumerateDevices)devices=await Promise.race([navigator.mediaDevices.enumerateDevices(),new Promise(resolve=>setTimeout(()=>resolve([]),1000))]);
  }catch{}
  if(run!==generation){candidate.getTracks().forEach(t=>t.stop());throw new DOMException('Camera cancelled','AbortError');}
  cameraLabels=devices.filter(d=>d.kind==='videoinput').map(d=>d.label||'이름 미제공');
  // Retain a working autofocus camera. Missing capabilities alone are not evidence that it cannot focus.
  if(supportsAutoFocus(initialTrack)||!modes?.length)return candidate;
  let originalId;
  try{originalId=initialTrack.getSettings?.().deviceId;}catch{}
  if(!originalId){
    const matches=devices.filter(d=>d.kind==='videoinput'&&d.label===initialTrack.label);
    if(matches.length===1)originalId=matches[0].deviceId;
  }
  if(!originalId)return candidate;
  const alternatives=devices.filter(d=>d.kind==='videoinput'&&d.deviceId&&d.deviceId!==originalId&&
    /back|rear|environment|후면/i.test(d.label)&&!/front|selfie|전면/i.test(d.label));
  if(!alternatives.length)return candidate;
  message('카메라를 준비하는 중입니다.');
  candidate.getTracks().forEach(t=>t.stop());
  for(const device of alternatives){
    if(run!==generation)throw new DOMException('Camera cancelled','AbortError');
    let probe;
    try{
      probe=await cameraRequest({...video,deviceId:{exact:device.deviceId}},run,3000);
      const track=probe.getVideoTracks()[0];
      const modes=focusModes(track);
      cameraSelection.push((track.label||device.label)+': '+(modes?.join('/')||'초점 정보 미제공'));
      if(supportsAutoFocus(track)&&track.getSettings?.().facingMode!=='user'){
        cameraSelection.push('자동초점 후면 선택');
        return probe;
      }
    }catch(error){
      if(run!==generation)throw error;
      cameraSelection.push(device.label+': 열기 실패');
    }
    if(probe)probe.getTracks().forEach(t=>t.stop());
  }
  if(run!==generation)throw new DOMException('Camera cancelled','AbortError');
  cameraSelection.push('자동초점 후면을 찾지 못해 원래 카메라 복원');
  try{return await cameraRequest({...video,deviceId:{exact:originalId}},run,3000);}
  catch(error){if(run!==generation)throw error;return cameraRequest(video,run,3000);}
}
async function tuneFocus(track,refocus=false,point=null){
  if(!track||typeof track.getCapabilities!=='function'||typeof track.applyConstraints!=='function')return {ok:false,point:false};
  let caps;try{caps=track.getCapabilities();}catch{return {ok:false,point:false};}
  const modes=Array.isArray(caps.focusMode)?caps.focusMode:[];
  const mode=refocus&&modes.includes('single-shot')?'single-shot':modes.includes('continuous')?'continuous':modes.includes('single-shot')?'single-shot':null;
  if(!mode)return {ok:false,point:false};
  let pointSupported=false;
  try{pointSupported=!!navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest;}catch{}
  if(point&&pointSupported){
    try{
      await track.applyConstraints({advanced:[{focusMode:mode,pointsOfInterest:[point]}]});
      // Keep single-shot focus in place; immediately restoring continuous may undo a tap.
      const settings=track.getSettings?.(),actual=settings?.pointsOfInterest?.[0];
      return {ok:true,point:!!actual&&Math.abs(actual.x-point.x)<0.03&&Math.abs(actual.y-point.y)<0.03,requested:true};
    }catch{}
  }
  try{await track.applyConstraints({advanced:[{focusMode:mode}]});return {ok:true,point:false};}
  catch{return {ok:false,point:false};}
}
function videoPoint(video,clientX,clientY){
  const r=video.getBoundingClientRect();
  if(!r.width||!r.height||!video.videoWidth||!video.videoHeight)return null;
  const scale=Math.min(r.width/video.videoWidth,r.height/video.videoHeight);
  const width=video.videoWidth*scale,height=video.videoHeight*scale;
  const x=(clientX-r.left-(r.width-width)/2)/width,y=(clientY-r.top-(r.height-height)/2)/height;
  return x>=0&&x<=1&&y>=0&&y<=1?{x,y}:null;
}
function showFocusPoint(x,y){
  document.getElementById('focus-marker')?.remove();
  const marker=document.createElement('div');marker.id='focus-marker';marker.setAttribute('aria-hidden','true');
  marker.style.cssText='position:fixed;z-index:5;pointer-events:none;width:52px;height:52px;border:2px solid #ffdc55;border-radius:50%;transform:translate(-50%,-50%);left:'+x+'px;top:'+y+'px';
  document.body.appendChild(marker);setTimeout(()=>marker.remove(),1500);
}
function formatManagementInput(input){
  const raw=input.value, before=raw.slice(0,input.selectionStart??raw.length).replace(/[^a-z0-9]/gi,'').length;
  const normalized=raw.toUpperCase().replace(/[^A-Z0-9]/g,''),prefix=/^[A-Z]{2}/.test(normalized)?2:1;
  const clean=normalized.slice(0,prefix+10);
  const formatted=[clean.slice(0,prefix),clean.slice(prefix,prefix+2),clean.slice(prefix+2,prefix+6),clean.slice(prefix+6,prefix+10)].filter(Boolean).join('-');
  input.value=formatted;
  const n=Math.min(before,clean.length),caret=n+(n>prefix?1:0)+(n>prefix+2?1:0)+(n>prefix+6?1:0);
  if(input.setSelectionRange)input.setSelectionRange(caret,caret);
  return formatted;
}
let navigating=false,inputTimer=null;
function navigateAsset(code){if(navigating)return;const url=assetUrl(code);navigating=true;clearTimeout(inputTimer);stop();message('확인 중입니다. 잠시만 기다려 주세요.');const overlay=document.createElement('div');overlay.id='loading';overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');overlay.textContent='확인 중입니다. 잠시만 기다려 주세요.';overlay.style.cssText='position:fixed;inset:0;z-index:100;display:grid;place-items:center;text-align:center;padding:24px;background:#101a25;color:#fff;font-size:20px;line-height:1.7';document.body.appendChild(overlay);requestAnimationFrame(()=>requestAnimationFrame(()=>window.location.replace(url)));}
function found(value){const code=normalizeCode(value);if(!code)return false;el('code').value=code;navigateAsset(code);return true;}
async function createNativeDetector(){
  try{
    if(typeof window.BarcodeDetector!=='function')return null;
    const formats=await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code')?new window.BarcodeDetector({formats:['qr_code']}):null;
  }catch{return null;}
}
function scanRegion(video,frameNumber){
  const crop=[1,0.7,0.45][frameNumber%3];
  const width=video.videoWidth*crop,height=video.videoHeight*crop;
  return {sx:(video.videoWidth-width)/2,sy:(video.videoHeight-height)/2,width,height};
}
async function start(){
  stop();const run=generation;el('start').disabled=true;el('stop').hidden=false;el('result').hidden=true;message('카메라를 여는 중입니다. 권한 요청이 나오면 허용해 주세요.');
  try{
    if(!window.isSecureContext)throw new Error('HTTPS 주소에서 스캔 페이지를 열어 주세요.');
    const policy=document.permissionsPolicy||document.featurePolicy;
    if(policy?.allowsFeature&&!policy.allowsFeature('camera'))throw new DOMException('Camera policy blocked','NotAllowedError');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('이 환경은 카메라를 지원하지 않습니다. 최신 Chrome 또는 삼성 인터넷에서 직접 열어 주세요.');
    const candidate=await acquireCamera(run);if(run!==generation){candidate.getTracks().forEach(t=>t.stop());return;}
    stream=candidate;const video=el('video');video.muted=true;video.srcObject=stream;video.hidden=false;el('start').hidden=true;
    const playback=video.play();if(playback&&typeof playback.catch==='function')playback.catch(error=>{if(run===generation)message('영상 재생이 멈췄습니다. 카메라 화면을 눌러 다시 시작해 주세요.');});
    if(run!==generation)return;
    message('');
    // Focus and native detection must never hold up the fallback scan loop.
    const track=stream.getVideoTracks()[0];
    void tuneFocus(track);
    let detector=null,nativeBusy=false,frameNumber=0;
    void createNativeDetector().then(value=>{if(run===generation)detector=value;});
    const tick=()=>{
      if(run!==generation)return;
      if(video.readyState>=2&&video.videoWidth&&video.videoHeight){

        try{
          if(ctx){
            const region=scanRegion(video,frameNumber++),scale=Math.min(1,1600/Math.max(region.width,region.height));
            canvas.width=Math.max(1,Math.round(region.width*scale));canvas.height=Math.max(1,Math.round(region.height*scale));
            ctx.drawImage(video,region.sx,region.sy,region.width,region.height,0,0,canvas.width,canvas.height);
            const image=ctx.getImageData(0,0,canvas.width,canvas.height);
        if(detector&&!nativeBusy){
          const active=detector;nativeBusy=true;
          Promise.resolve().then(()=>active.detect(image)).then(codes=>{
            if(run!==generation)return;
            for(const code of codes){if(found(code.rawValue))break;}
          }).catch(()=>{if(detector===active)detector=null;}).finally(()=>{nativeBusy=false;});
        }
            if(typeof jsQR==='function'){
            const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
            if(code&&found(code.data))return;
            }
          }
        }catch(error){
          // A bad video frame must not permanently stop recognition.
          console.warn('QR frame skipped',error);
        }
      }
      if(run===generation)setTimeout(tick,180);
    };
    tick();
  }catch(error){if(run===generation){stop();message(cameraError(error));}}
}
el('video').addEventListener('click',event=>{
  if(!stream||navigating)return;
  const video=el('video'),point=videoPoint(video,event.clientX,event.clientY);
  if(!point)return;
  showFocusPoint(event.clientX,event.clientY);
  if(video.paused)void video.play().catch(()=>{});
  void tuneFocus(stream.getVideoTracks()[0],true,point);
});
el('start').onclick=start;el('stop').onclick=stop;
el('lookup').onclick=()=>{try{navigateAsset(el('code').value);}catch(error){message(error.message);}};
el('code').addEventListener('input',()=>{clearTimeout(inputTimer);const code=formatManagementInput(el('code'));if(code&&/^[A-Z]{1,2}-\d{2}-\d{4}-\d{4}$/.test(code))inputTimer=setTimeout(()=>navigateAsset(code),650);});
el('code').addEventListener('keydown',e=>{if(e.key==='Enter')el('lookup').click();});
window.addEventListener('pagehide',()=>{clearTimeout(inputTimer);stop();});window.addEventListener('pageshow',()=>{navigating=false;el('loading')?.remove();start();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(inputTimer);stop();}else if(!navigating&&!stream){start();}});




