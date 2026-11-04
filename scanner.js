'use strict';
const APP_URL='https://script.google.com/macros/s/AKfycbyQjy5N30aaxIEOIpxTH2hgUhXkumoYUV6zSudzOeVlLqw0zMWFmiydq80Qi0JdcS9r/exec';
const el=id=>document.getElementById(id);
let stream=null,generation=0;
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
function normalizeCode(value){const code=String(value||'').trim().toUpperCase();return code.length<=80&&/^[A-Z0-9]+(?:-[A-Z0-9]+){2,5}$/.test(code)?code:null;}
function assetUrl(code){const valid=normalizeCode(code);if(!valid)throw new Error('관리번호 형식을 확인해 주세요.');const url=new URL(APP_URL);url.searchParams.set('code',valid);return url.href;}
function message(text){el('message').textContent=text;}
function stop(){generation++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;el('video').srcObject=null;el('video').hidden=true;el('stop').hidden=true;el('start').disabled=false;}
function cameraError(error){
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy?.allowsFeature&&!policy.allowsFeature('camera'))return '이 페이지가 다른 앱이나 사이트 안에 삽입되어 카메라가 차단되었습니다. 스캔 페이지 주소를 Chrome 또는 삼성 인터넷의 새 탭에서 직접 열어 주세요.';
  if(error.name==='NotAllowedError'||error.name==='SecurityError')return '카메라 권한이 차단되어 있습니다. 브라우저의 이 사이트 권한에서 카메라를 허용하고, 휴대폰 설정에서도 해당 브라우저의 카메라 권한을 확인해 주세요.';
  if(error.name==='NotFoundError')return '사용 가능한 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰에서 열어 주세요.';
  if(error.name==='NotReadableError'||error.name==='AbortError')return '다른 앱에서 카메라를 사용 중일 수 있습니다. 카메라 앱을 닫고 다시 눌러 주세요.';
  return error.message||'카메라를 시작하지 못했습니다. 관리번호로 검색할 수 있습니다.';
}
async function acquireCamera(){
  try{return await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});}
  catch(error){if(error.name!=='OverconstrainedError')throw error;return navigator.mediaDevices.getUserMedia({audio:false,video:true});}
}
async function tuneFocus(track,refocus=false){
 if(!track||typeof track.getCapabilities!=='function'||typeof track.applyConstraints!=='function')return false;
 let caps;try{caps=track.getCapabilities();}catch{return false;}
 const modes=Array.isArray(caps.focusMode)?caps.focusMode:[];
 const mode=refocus&&modes.includes('single-shot')?'single-shot':modes.includes('continuous')?'continuous':modes.includes('single-shot')?'single-shot':null;
 if(!mode)return false;
 try{await track.applyConstraints({...track.getConstraints?.(),advanced:[{focusMode:mode}]});
 if(mode==='single-shot'&&modes.includes('continuous'))await track.applyConstraints({...track.getConstraints?.(),advanced:[{focusMode:'continuous'}]});return true;}catch{return false;}
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
async function start(){
  stop();const run=generation;el('start').disabled=true;el('stop').hidden=false;el('result').hidden=true;message('카메라를 여는 중입니다. 권한 요청이 나오면 허용해 주세요.');
  try{
    if(!window.isSecureContext)throw new Error('HTTPS 주소에서 스캔 페이지를 열어 주세요.');
    const policy=document.permissionsPolicy||document.featurePolicy;
    if(policy?.allowsFeature&&!policy.allowsFeature('camera'))throw new DOMException('Camera policy blocked','NotAllowedError');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('이 환경은 카메라를 지원하지 않습니다. 최신 Chrome 또는 삼성 인터넷에서 직접 열어 주세요.');
    const candidate=await acquireCamera();if(run!==generation){candidate.getTracks().forEach(t=>t.stop());return;}
    stream=candidate;const video=el('video');video.muted=true;video.srcObject=stream;video.hidden=false;await video.play();
    if(run!==generation)return;
    message('QR을 화면 가운데 두세요. 화면을 누르면 초점을 다시 맞춥니다.');
    // Focus and native detection must never hold up the fallback scan loop.
    void tuneFocus(stream.getVideoTracks()[0]);
    let detector=null,nativeBusy=false,frameNumber=0;
    void createNativeDetector().then(value=>{if(run===generation)detector=value;});
    const tick=()=>{
      if(run!==generation)return;
      if(video.readyState>=2&&video.videoWidth&&video.videoHeight){
        if(detector&&!nativeBusy){
          const active=detector;nativeBusy=true;
          Promise.resolve().then(()=>active.detect(video)).then(codes=>{
            if(run!==generation)return;
            for(const code of codes){if(found(code.rawValue))break;}
          }).catch(()=>{if(detector===active)detector=null;}).finally(()=>{nativeBusy=false;});
        }
        try{
          if(ctx&&typeof jsQR==='function'){
            const crop=[1,0.7,0.45][frameNumber++%3],sw=video.videoWidth*crop,sh=video.videoHeight*crop;
            const scale=Math.min(1,1600/sw);
            canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
            ctx.drawImage(video,(video.videoWidth-sw)/2,(video.videoHeight-sh)/2,sw,sh,0,0,canvas.width,canvas.height);
            const image=ctx.getImageData(0,0,canvas.width,canvas.height);
            const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
            if(code&&found(code.data))return;
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
el('video').addEventListener('click',async()=>{if(!stream||navigating)return;const active=stream,ok=await tuneFocus(active.getVideoTracks()[0],true);if(stream===active)message(ok?'초점을 다시 맞추고 있습니다. 잠시 움직이지 말아 주세요.':'흐리면 QR에서 조금 떨어뜨린 뒤 천천히 가까이 가져가 주세요.');});
el('start').onclick=start;el('stop').onclick=stop;
el('lookup').onclick=()=>{try{navigateAsset(el('code').value);}catch(error){message(error.message);}};
el('code').addEventListener('input',()=>{clearTimeout(inputTimer);const code=formatManagementInput(el('code'));if(code&&/^[A-Z]{1,2}-\d{2}-\d{4}-\d{4}$/.test(code))inputTimer=setTimeout(()=>navigateAsset(code),650);});
el('code').addEventListener('keydown',e=>{if(e.key==='Enter')el('lookup').click();});
window.addEventListener('pagehide',()=>{clearTimeout(inputTimer);stop();});window.addEventListener('pageshow',()=>{navigating=false;el('loading')?.remove();start();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(inputTimer);stop();}else if(!navigating&&!stream){start();}});
