'use strict';
const APP_URL='https://script.google.com/macros/s/AKfycbyQjy5N30aaxIEOIpxTH2hgUhXkumoYUV6zSudzOeVlLqw0zMWFmiydq80Qi0JdcS9r/exec';
const el=id=>document.getElementById(id);
let stream=null,generation=0;
const compareMode=new URL(window.location.href).searchParams.get('compare')==='1';
let lastDecoded='',cameraLabels=[];
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
function normalizeCode(value){const code=String(value||'').trim().toUpperCase();return code.length<=80&&/^[A-Z0-9]+(?:-[A-Z0-9]+){2,5}$/.test(code)?code:null;}
function assetUrl(code){const valid=normalizeCode(code);if(!valid)throw new Error('관리번호 형식을 확인해 주세요.');const url=new URL(APP_URL);url.searchParams.set('code',valid);return url.href;}
function message(text){el('message').textContent=text;}
function stop(){generation++;document.getElementById('focus-marker')?.remove();if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;el('video').srcObject=null;el('video').hidden=true;if(el('scan-guide'))el('scan-guide').hidden=true;el('stop').hidden=true;el('start').disabled=false;}
function cameraError(error){
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy?.allowsFeature&&!policy.allowsFeature('camera'))return '이 페이지가 다른 앱이나 사이트 안에 삽입되어 카메라가 차단되었습니다. 스캔 페이지 주소를 Chrome 또는 삼성 인터넷의 새 탭에서 직접 열어 주세요.';
  if(error.name==='NotAllowedError'||error.name==='SecurityError')return '카메라 권한이 차단되어 있습니다. 브라우저의 이 사이트 권한에서 카메라를 허용하고, 휴대폰 설정에서도 해당 브라우저의 카메라 권한을 확인해 주세요.';
  if(error.name==='NotFoundError')return '사용 가능한 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰에서 열어 주세요.';
  if(error.name==='NotReadableError'||error.name==='AbortError')return '다른 앱에서 카메라를 사용 중일 수 있습니다. 카메라 앱을 닫고 다시 눌러 주세요.';
  return error.message||'카메라를 시작하지 못했습니다. 관리번호로 검색할 수 있습니다.';
}
function preferredRearCamera(devices){
  return devices.find(d=>d.kind==='videoinput'&&
    !/front|selfie|user|전면|ultra|tele|초광각|망원/i.test(d.label)&&
    /back|rear|environment|후면/i.test(d.label)&&
    /main|primary|standard|메인|기본|일반|wide[ -]?angle/i.test(d.label));
}
async function acquireCamera(run){
  const video={facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}};
  let candidate;
  try{candidate=await navigator.mediaDevices.getUserMedia({audio:false,video});}
  catch(error){if(error.name!=='OverconstrainedError')throw error;candidate=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});}
  try{
    if(run!==generation||!navigator.mediaDevices.enumerateDevices)return candidate;
    const devices=await Promise.race([navigator.mediaDevices.enumerateDevices(),new Promise(resolve=>setTimeout(()=>resolve([]),700))]);
    if(run!==generation)return candidate;
    cameraLabels=devices.filter(d=>d.kind==='videoinput').map(d=>d.label||'이름 미제공');
    const preferred=preferredRearCamera(devices),current=candidate.getVideoTracks()[0].getSettings?.().deviceId;
    // Generic camera numbers cannot identify a physical lens. Switch only on an explicit main-camera label.
    if(preferred&&current&&preferred.deviceId!==current){
      candidate.getTracks().forEach(t=>t.stop());
      try{candidate=await navigator.mediaDevices.getUserMedia({audio:false,video:{...video,deviceId:{exact:preferred.deviceId}}});}
      catch{candidate=await navigator.mediaDevices.getUserMedia({audio:false,video});}
    }
    return candidate;
  }catch{return candidate;}
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
  marker.style.cssText='position:fixed;z-index:5;pointer-events:none;width:52px;height:52px;border:2px solid #ffdc55;border-radius:8px;transform:translate(-50%,-50%);left:'+x+'px;top:'+y+'px';
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
function found(value){const code=normalizeCode(value);if(!code)return false;if(compareMode){lastDecoded=code;return false;}el('code').value=code;navigateAsset(code);return true;}
async function createNativeDetector(){
  try{
    if(typeof window.BarcodeDetector!=='function')return null;
    const formats=await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code')?new window.BarcodeDetector({formats:['qr_code']}):null;
  }catch{return null;}
}
function scanRegion(video){
  const vw=video.videoWidth,vh=video.videoHeight;
  const r=video.getBoundingClientRect?.();
  let side=Math.min(vw,vh)*0.78;
  if(r?.width&&r?.height){
    const scale=Math.min(r.width/vw,r.height/vh);
    const size=Math.min(vw*scale*0.78,vh*scale*0.62,320);
    side=Math.min(vw,vh,size/scale);
    const guide=el('scan-guide');if(guide){guide.style.width=size+'px';guide.style.height=size+'px';guide.hidden=false;}
  }
  return {sx:(vw-side)/2,sy:(vh-side)/2,side};
}
function scanDiagnostics(video,track,run){
  const stats={frames:0,js:0,native:0,nativeState:'확인 중',focus:'확인 중',lastError:'',invalid:''};
  const started=Date.now();let lastPaint=0;
  let caps={};try{caps=track.getCapabilities?.()||{};}catch{}
  const paint=()=>{
    if(run!==generation||navigating||Date.now()-started<(compareMode?1500:8000)||Date.now()-lastPaint<2000)return;
    lastPaint=Date.now();
    let settings={};try{settings=track.getSettings?track.getSettings():{};}catch{}
    const resolution=video.videoWidth+'×'+video.videoHeight;
    const text=[compareMode?(lastDecoded?'QR 인식 성공: '+lastDecoded:'비교 점검 중 · QR을 네모 안에 맞춰 주세요.'):'QR을 네모 안에 맞춰 주세요. 아직 인식되지 않았습니다.',
      '점검 v11 | 영상 '+resolution+' / 준비 '+video.readyState+' / 재생 '+(!video.paused),
      '검사 '+stats.frames+'회 | 보조 '+stats.js+'회 | 내장 '+stats.nativeState+' '+stats.native+'회',
      '카메라 '+(track.label||'이름 없음')+' | 방향 '+(settings.facingMode||'미제공'),
      '초점 '+(settings.focusMode||stats.focus)+' | 거리 '+(settings.focusDistance??'미제공')+' | 줌 '+(settings.zoom??'미제공')];
    if(compareMode){
      text.push('지원 초점 '+(caps.focusMode||[]).join('/')+' | 위치 초점 '+!!navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest);
      text.push('카메라 목록 '+cameraLabels.join(' / '));
      text.push('브라우저 '+(navigator.userAgent||'미제공'));
      text.push('비교 점검에서는 자동으로 자산 화면으로 이동하지 않습니다.');
    }
    if(stats.lastError)text.push('오류 '+stats.lastError);
    if(stats.invalid)text.push('읽은 내용 '+stats.invalid);
    message(text.join('\n'));
  };
  return {stats,paint};
}
async function start(){
  stop();const run=generation;el('start').disabled=true;el('stop').hidden=false;el('result').hidden=true;message('카메라를 여는 중입니다. 권한 요청이 나오면 허용해 주세요.');
  try{
    if(!window.isSecureContext)throw new Error('HTTPS 주소에서 스캔 페이지를 열어 주세요.');
    const policy=document.permissionsPolicy||document.featurePolicy;
    if(policy?.allowsFeature&&!policy.allowsFeature('camera'))throw new DOMException('Camera policy blocked','NotAllowedError');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('이 환경은 카메라를 지원하지 않습니다. 최신 Chrome 또는 삼성 인터넷에서 직접 열어 주세요.');
    const candidate=await acquireCamera(run);if(run!==generation){candidate.getTracks().forEach(t=>t.stop());return;}
    stream=candidate;const video=el('video');video.muted=true;video.srcObject=stream;video.hidden=false;
    const playback=video.play();if(playback&&typeof playback.catch==='function')playback.catch(error=>{if(run===generation)message('영상 재생이 멈췄습니다. 카메라 화면을 눌러 다시 시작해 주세요.');});
    if(run!==generation)return;
    message('QR을 네모 안에 크게 맞춰 주세요. QR 부분을 누르면 초점을 요청합니다.');
    // Focus and native detection must never hold up the fallback scan loop.
    const track=stream.getVideoTracks()[0],health=scanDiagnostics(video,track,run),stats=health.stats;
    void tuneFocus(track).then(result=>{stats.focus=result.ok?'자동초점 요청':'자동 설정 미지원';});
    let detector=null,nativeBusy=false,frameNumber=0;
    void createNativeDetector().then(value=>{if(run===generation){detector=value;stats.nativeState=value?'사용':'미지원';}});
    const tick=()=>{
      if(run!==generation)return;
      health.paint();
      if(video.readyState>=2&&video.videoWidth&&video.videoHeight){
        stats.frames++;

        try{
          if(ctx){
            const region=scanRegion(video),scale=Math.min(1,1600/region.side);
            canvas.width=Math.max(1,Math.round(region.side*scale));canvas.height=canvas.width;
            ctx.drawImage(video,region.sx,region.sy,region.side,region.side,0,0,canvas.width,canvas.height);
            const image=ctx.getImageData(0,0,canvas.width,canvas.height);
        if(detector&&!nativeBusy){
          const active=detector;nativeBusy=true;
          Promise.resolve().then(()=>active.detect(image)).then(codes=>{
            if(run!==generation)return;
            stats.native++;
            for(const code of codes){if(found(code.rawValue))break;if(!normalizeCode(code.rawValue))stats.invalid=String(code.rawValue).slice(0,80);}
          }).catch(error=>{if(detector===active){detector=null;stats.nativeState='오류';stats.lastError=String(error.name||error.message||error).slice(0,100);}}).finally(()=>{nativeBusy=false;});
        }
            if(typeof jsQR==='function'){
            stats.js++;
            const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
            if(code){if(found(code.data))return;if(!normalizeCode(code.data))stats.invalid=String(code.data).slice(0,80);}
            }
          }
        }catch(error){
          // A bad video frame must not permanently stop recognition.
          stats.lastError=String(error.name||error.message||error).slice(0,100);
          console.warn('QR frame skipped',error);
        }
      }
      if(run===generation)setTimeout(tick,180);
    };
    tick();
  }catch(error){if(run===generation){stop();message(cameraError(error));}}
}
el('video').addEventListener('click',async event=>{
  if(!stream||navigating)return;
  const video=el('video'),point=videoPoint(video,event.clientX,event.clientY);
  if(!point)return;
  showFocusPoint(event.clientX,event.clientY);
  const active=stream,run=generation;
  if(video.paused)void video.play().catch(()=>{});
  message('누른 위치로 초점을 요청하고 있습니다. 잠시 움직이지 말아 주세요.');
  const result=await tuneFocus(active.getVideoTracks()[0],true,point);
  if(stream!==active||run!==generation)return;
  message(result.point?'누른 위치로 초점 설정을 전달했습니다. QR을 잠시 고정해 주세요.':
    result.requested?'누른 위치로 초점을 요청했습니다. 기기에서 실제 적용 여부를 알려주지 않습니다.':
    result.ok?'이 브라우저는 위치 초점을 지원하지 않아 일반 자동초점을 다시 요청했습니다.':
    '이 카메라는 웹에서 초점 조절을 지원하지 않습니다. 조금 떨어져서 비춰 주세요.');
});
el('start').onclick=start;el('stop').onclick=stop;
el('lookup').onclick=()=>{try{navigateAsset(el('code').value);}catch(error){message(error.message);}};
el('code').addEventListener('input',()=>{clearTimeout(inputTimer);const code=formatManagementInput(el('code'));if(code&&/^[A-Z]{1,2}-\d{2}-\d{4}-\d{4}$/.test(code))inputTimer=setTimeout(()=>navigateAsset(code),650);});
el('code').addEventListener('keydown',e=>{if(e.key==='Enter')el('lookup').click();});
window.addEventListener('pagehide',()=>{clearTimeout(inputTimer);stop();});window.addEventListener('pageshow',()=>{navigating=false;el('loading')?.remove();start();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(inputTimer);stop();}else if(!navigating&&!stream){start();}});


