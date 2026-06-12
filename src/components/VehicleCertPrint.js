// =============================================
// VehicleCertPrint.js — 차량소독 증명서 출력
// - 사진 업로드 → Claude AI가 번호판 자동 인식
// - 여러 차량: 쉼표(,)로 구분
// - 양식 2종 (차량소독_A, 차량소독_B)
// - localStorage 저장키: wl_vehicle_cfg_v1
// =============================================
import React, { useState, useCallback, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

const CFG_KEY = 'wl_vehicle_cfg_v1';

// ── 번호판 AI 인식 (Claude API) ───────────────
async function detectPlatesFromImage(base64Data, mediaType, apiKey) {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data }
            },
            {
              type: 'text',
              text: `이 이미지에서 차량 번호판을 모두 찾아주세요.
한국 번호판 형식 예시: 94자4567, 경기93고4567, 12가3456, 서울12나3456
번호판만 쉼표로 구분해서 나열하세요. 번호판이 없으면 "없음"이라고 답하세요.
다른 설명 없이 번호판 목록만 출력하세요.`
            }
          ]
        }]
      })
    });
    const data = await resp.json();
    const text = data.content?.find(c => c.type === 'text')?.text?.trim() || '';
    if (!text || text === '없음') return [];
    return text.split(',').map(p => p.trim()).filter(Boolean);
  } catch (e) {
    console.error('번호판 인식 오류:', e);
    return [];
  }
}

// ── 이미지 → base64 변환 ──────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ b64: r.result.split(',')[1], mediaType: file.type });
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── 인쇄 CSS ─────────────────────────────────
const PRINT_CSS = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family:'Malgun Gothic','맑은 고딕',serif; }
  .page { position:relative; width:210mm; height:297mm;
    page-break-after:always; overflow:hidden; background:white; }
  .page:last-child { page-break-after:auto; }
  .bg { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; }
  .f  { position:absolute; white-space:pre-wrap; line-height:1.35; color:#1a1a1a; z-index:2; }
`;

// ── 양식별 기본 필드 좌표 ─────────────────────
// 차량소독 양식을 받으면 이 좌표를 실제 양식에 맞게 조정
const FORM_CONFIGS = {
  A: {
    label: '차량소독 양식 A',
    bgImage: null,   // 양식 이미지 받으면 여기에 base64 입력
    fields: {
      certNo:    { x: 20,  y: 20  },
      plateNos:  { x: 60,  y: 60  },  // 차량번호 (쉼표 구분)
      issueDate: { x: 120, y: 180 },
      coName:    { x: 100, y: 220 },
      coAddr:    { x: 120, y: 232 },
      coCeo:     { x: 120, y: 244 },
    }
  },
  B: {
    label: '차량소독 양식 B',
    bgImage: null,
    fields: {
      certNo:    { x: 20,  y: 20  },
      plateNos:  { x: 60,  y: 60  },
      issueDate: { x: 120, y: 180 },
      coName:    { x: 100, y: 220 },
      coAddr:    { x: 120, y: 232 },
      coCeo:     { x: 120, y: 244 },
    }
  }
};

const MOVE_STEPS = [0.5, 1, 2, 5, 10];
const FIELD_LABELS_V = {
  certNo:   '증명서 번호',
  plateNos: '차량 번호',
  issueDate:'발행일',
  coName:   '업체 상호',
  coAddr:   '업체 소재지',
  coCeo:    '대표자',
};

const todayFmt = () => {
  const [y,m,d] = new Date().toISOString().split('T')[0].split('-');
  return `${y}년  ${m}월  ${d}일`;
};

function buildVehicleCertHtml(plates, cfg, formType, fontSize) {
  const FC = FORM_CONFIGS[formType];
  const F  = cfg.fields[formType];
  const f  = (k,txt,ex='') =>
    `<div class="f" style="left:${F[k].x}mm;top:${F[k].y}mm;font-size:${fontSize}px;${ex}">${txt}</div>`;

  const bgHtml = FC.bgImage
    ? `<img class="bg" src="${FC.bgImage}" alt=""/>`
    : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:14px;border:2px dashed #ddd;">[차량소독 양식 ${formType} — 양식 이미지 미등록]</div>`;

  return `<div class="page">
    ${bgHtml}
    ${cfg.certNoPrefix?f('certNo',cfg.certNoPrefix):''}
    ${f('plateNos', plates.join(', '),'font-weight:bold;')}
    ${f('issueDate', todayFmt())}
    ${f('coName', cfg.coName||'')}
    ${f('coAddr', cfg.coAddr||'')}
    ${f('coCeo',  cfg.coCeo||'')}
  </div>`;
}

function VehicleCertPrint({ onClose }) {
  const [cfg, setCfg] = useState(() => {
    try {
      const s = localStorage.getItem(CFG_KEY);
      const p = s ? JSON.parse(s) : {};
      return {
        step:         p.step        ?? 1,
        fontSize:     p.fontSize    ?? 10,
        formType:     p.formType    ?? 'A',
        coName:       p.coName      ?? '',
        coAddr:       p.coAddr      ?? '',
        coCeo:        p.coCeo       ?? '',
        certNoPrefix: p.certNoPrefix?? '',
        fields: {
          A: { ...FORM_CONFIGS.A.fields, ...(p.fields?.A || {}) },
          B: { ...FORM_CONFIGS.B.fields, ...(p.fields?.B || {}) },
        }
      };
    } catch {
      return { step:1, fontSize:10, formType:'A', coName:'', coAddr:'', coCeo:'',
               certNoPrefix:'', fields:{ A:{...FORM_CONFIGS.A.fields}, B:{...FORM_CONFIGS.B.fields} } };
    }
  });

  const [plates,    setPlates]    = useState([]);   // 인식/수동 입력된 번호판 목록
  const [manualInput, setManual]  = useState('');   // 수동 입력 버퍼
  const [detecting, setDetecting] = useState(false);
  const [selField,  setSelField]  = useState(null);
  const [editIdx,   setEditIdx]   = useState(null);
  const [editVal,   setEditVal]   = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');

  // Firestore에서 API 키 로드
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'settings'));
        if (snap.docs.length > 0) {
          setAnthropicApiKey(snap.docs[0].data().anthropicApiKey || '');
        }
      } catch (e) { console.error('API 키 로드 실패:', e); }
    })();
  }, []);

  // cfg 저장
  const saveCfg = (next) => {
    const merged = { ...cfg, ...next };
    setCfg(merged);
    localStorage.setItem(CFG_KEY, JSON.stringify(merged));
  };

  // 이미지 업로드 → AI 번호판 인식
  const handleImageUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (!anthropicApiKey) {
      Swal.fire('API 키 없음', '설정 페이지에서 Anthropic API 키를 먼저 등록해주세요.', 'warning');
      return;
    }

    setDetecting(true);
    Swal.fire({ title: '🔍 번호판 인식 중...', text: `${files.length}장 분석 중`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const allPlates = [];
    for (const file of files) {
      try {
        const { b64, mediaType } = await fileToBase64(file);
        const found = await detectPlatesFromImage(b64, mediaType, anthropicApiKey);
        allPlates.push(...found);
      } catch (err) { console.warn('인식 실패:', err); }
    }
    Swal.close();
    setDetecting(false);

    const unique = [...new Set([...plates, ...allPlates])];
    if (allPlates.length === 0) {
      Swal.fire('알림', '번호판을 감지하지 못했습니다.\n직접 입력해주세요.', 'warning');
    } else {
      Swal.fire({
        icon: 'success', timer: 1500, showConfirmButton: false,
        title: `✅ ${allPlates.length}개 번호판 인식됨`,
        text: allPlates.join(', ')
      });
    }
    setPlates(unique);
    e.target.value = '';
  }, [plates]);

  // 수동 추가
  const addManual = () => {
    const items = manualInput.split(',').map(s => s.trim()).filter(Boolean);
    setPlates(prev => [...new Set([...prev, ...items])]);
    setManual('');
  };

  // 번호판 삭제
  const removePlate = (i) => setPlates(prev => prev.filter((_, idx) => idx !== i));

  // 번호판 편집 저장
  const saveEdit = () => {
    setPlates(prev => prev.map((p, i) => i === editIdx ? editVal : p));
    setEditIdx(null);
  };

  // 인쇄
  const handlePrint = () => {
    if (!plates.length) { Swal.fire('알림', '번호판을 하나 이상 입력하세요.', 'warning'); return; }
    const html = buildVehicleCertHtml(plates, cfg, cfg.formType, cfg.fontSize);
    const win  = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${html}</body></html>`);
    win.document.close();
    win.onafterprint = () => win.close();
    setTimeout(() => { win.focus(); win.print(); }, 500);
  };

  const moveField = (key, ax, delta) => {
    const next = {
      ...cfg,
      fields: {
        ...cfg.fields,
        [cfg.formType]: {
          ...cfg.fields[cfg.formType],
          [key]: {
            ...cfg.fields[cfg.formType][key],
            [ax]: Math.round((cfg.fields[cfg.formType][key][ax] + delta) * 10) / 10
          }
        }
      }
    };
    saveCfg(next);
  };

  const S = {
    overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:9999,
               display:'flex', flexDirection:'column', alignItems:'center',
               overflowY:'auto', padding:'12px 8px' },
    box:     { width:'100%', maxWidth:800, borderRadius:10, overflow:'hidden',
               boxShadow:'0 8px 32px rgba(0,0,0,0.3)', background:'#fff' },
    hdr:     { background:'#065f46', color:'#fff', padding:'10px 14px',
               display:'flex', justifyContent:'space-between', alignItems:'center' },
    panel:   { background:'#f0fdf4', borderBottom:'1px solid #bbf7d0',
               padding:'10px 14px', display:'flex', flexWrap:'wrap', gap:10, alignItems:'flex-start' },
    lbl:     { fontSize:11, color:'#6b7280', marginBottom:3 },
    inp:     { padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, background:'#fff' },
    tog:     (on, col='#3b82f6') => ({
               padding:'4px 9px', fontSize:12, borderRadius:5, cursor:'pointer',
               border:`1.5px solid ${on?col:'#d1d5db'}`, background:on?col+'22':'#fff',
               color:on?col:'#6b7280', fontWeight:on?'bold':'normal' }),
    fld:     (on) => ({
               padding:'3px 8px', fontSize:11, borderRadius:5, cursor:'pointer',
               border:`1.5px solid ${on?'#6366f1':'#e2e8f0'}`, background:on?'#ede9fe':'#f9fafb',
               color:on?'#4f46e5':'#64748b', fontWeight:on?'bold':'normal', whiteSpace:'nowrap' }),
    dir:     { padding:'5px 12px', background:'#6366f1', color:'#fff',
               border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:'bold' },
  };

  return (
    <div style={S.overlay}>
      <div style={S.box}>
        {/* 헤더 */}
        <div style={S.hdr}>
          <b style={{fontSize:15}}>🚗 차량소독 증명서 출력</b>
          <div style={{display:'flex', gap:8}}>
            <button onClick={handlePrint} style={{
              padding:'7px 18px', background:'#10b981', color:'#fff',
              border:'none', borderRadius:7, cursor:'pointer', fontWeight:'bold', fontSize:13
            }}>🖨️ 인쇄</button>
            <button onClick={onClose} style={{
              padding:'7px 14px', background:'#ef4444', color:'#fff',
              border:'none', borderRadius:7, cursor:'pointer', fontWeight:'bold', fontSize:13
            }}>✕ 닫기</button>
          </div>
        </div>

        {/* 양식 선택 + 업체 정보 */}
        <div style={S.panel}>
          <div>
            <div style={S.lbl}>양식 선택</div>
            <div style={{display:'flex', gap:4}}>
              {['A','B'].map(t => (
                <button key={t} style={S.tog(cfg.formType===t, '#065f46')}
                  onClick={() => saveCfg({...cfg, formType:t})}>
                  양식 {t}{!FORM_CONFIGS[t].bgImage?' (미등록)':''}
                </button>
              ))}
            </div>
          </div>
          {[['coName','업체명',120],['coAddr','소재지',200],['coCeo','대표자',100],['certNoPrefix','증명서 번호',110]].map(([k,lbl,w])=>(
            <div key={k}><div style={S.lbl}>{lbl}</div>
            <input style={{...S.inp,width:w}} value={cfg[k]||''} placeholder={lbl}
              onChange={e=>saveCfg({...cfg,[k]:e.target.value})}/></div>
          ))}
        </div>

        {/* 사진 업로드 + 번호판 */}
        <div style={{background:'#fff', padding:'14px', borderBottom:'1px solid #e2e8f0'}}>
          <div style={{fontSize:13, fontWeight:'bold', color:'#374151', marginBottom:10}}>
            🔍 번호판 인식
          </div>

          {/* 드롭 영역 */}
          <label style={{
            display:'block', padding:'24px', textAlign:'center',
            border:'2px dashed #86efac', borderRadius:10, cursor:'pointer',
            background:'#f0fdf4', marginBottom:12, position:'relative',
          }}>
            <div style={{fontSize:36, marginBottom:6}}>📷</div>
            <div style={{fontSize:13, fontWeight:'bold', color:'#065f46'}}>
              차량 사진 업로드
            </div>
            <div style={{fontSize:11, color:'#6b7280', marginTop:4}}>
              JPG, PNG, HEIC 등 — 여러 장 동시 업로드 가능
            </div>
            <input type="file" accept="image/*" multiple
              style={{position:'absolute',inset:0,opacity:0,cursor:'pointer'}}
              onChange={handleImageUpload} disabled={detecting}/>
          </label>

          {/* 수동 입력 */}
          <div style={{display:'flex', gap:6, marginBottom:12}}>
            <input
              value={manualInput}
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => e.key==='Enter' && addManual()}
              placeholder="번호판 직접 입력 (여러 개는 쉼표로 구분)"
              style={{...S.inp, flex:1}}
            />
            <button onClick={addManual} style={{
              padding:'6px 14px', background:'#3b82f6', color:'#fff',
              border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:'bold'
            }}>+ 추가</button>
          </div>

          {/* 번호판 목록 */}
          {plates.length > 0 && (
            <div>
              <div style={{fontSize:12, color:'#374151', fontWeight:'bold', marginBottom:6}}>
                🚗 인식/입력된 번호판 ({plates.length}개)
              </div>
              <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                {plates.map((p, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'center', gap:4,
                    background: editIdx===i ? '#eff6ff' : '#f0fdf4',
                    border:`1.5px solid ${editIdx===i?'#3b82f6':'#86efac'}`,
                    borderRadius:20, padding:'4px 10px',
                  }}>
                    {editIdx===i ? (
                      <>
                        <input value={editVal} onChange={e=>setEditVal(e.target.value)}
                          onKeyDown={e=>e.key==='Enter'&&saveEdit()}
                          style={{...S.inp,width:110,padding:'2px 6px',fontSize:12}}
                          autoFocus/>
                        <button onClick={saveEdit} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,color:'#10b981'}}>✅</button>
                      </>
                    ) : (
                      <>
                        <span style={{fontSize:13,fontWeight:'bold',color:'#065f46'}}>{p}</span>
                        <button onClick={()=>{setEditIdx(i);setEditVal(p);}} style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#6b7280'}}>✏️</button>
                        <button onClick={()=>removePlate(i)} style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#ef4444'}}>✕</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 양식 미등록 안내 */}
          {!FORM_CONFIGS[cfg.formType].bgImage && (
            <div style={{
              marginTop:12, padding:'10px 14px', background:'#fef3c7',
              borderRadius:8, fontSize:12, color:'#92400e',
            }}>
              ⚠️ 양식 {cfg.formType} 이미지가 아직 등록되지 않았습니다.<br/>
              차량소독 양식 파일을 제공해주시면 즉시 반영해드릴게요!<br/>
              <span style={{fontSize:11}}>현재는 빈 A4에 데이터만 출력됩니다.</span>
            </div>
          )}
        </div>

        {/* 필드 위치 조정 */}
        <div style={{...S.panel, flexDirection:'column', gap:6, background:'#f8fafc'}}>
          <div style={{fontSize:12, fontWeight:'bold', color:'#374151'}}>
            📍 필드 위치 조정 — 양식 {cfg.formType}
          </div>
          <div style={{display:'flex', gap:3}}>
            <span style={{fontSize:11,color:'#6b7280',marginRight:4}}>이동단위:</span>
            {MOVE_STEPS.map(s=>(
              <button key={s} style={S.tog(cfg.step===s)}
                onClick={()=>saveCfg({...cfg,step:s})}>{s}</button>
            ))}
          </div>
          <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
            {Object.entries(FIELD_LABELS_V).map(([k,lbl])=>(
              <button key={k} style={S.fld(selField===k)}
                onClick={()=>setSelField(p=>p===k?null:k)}>{lbl}</button>
            ))}
          </div>
          {selField && (
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',background:'#eef2ff',padding:'8px 12px',borderRadius:8}}>
              <span style={{fontSize:12,fontWeight:'bold',color:'#4f46e5',minWidth:80}}>{FIELD_LABELS_V[selField]}</span>
              <span style={{fontSize:11,color:'#64748b'}}>
                X:{cfg.fields[cfg.formType][selField]?.x}mm  Y:{cfg.fields[cfg.formType][selField]?.y}mm
              </span>
              {[['← 좌','x',-1],['→ 우','x',1],['↑ 위','y',-1],['↓ 아래','y',1]].map(([lbl,ax,dir])=>(
                <button key={lbl} style={S.dir}
                  onClick={()=>moveField(selField,ax,dir*cfg.step)}>{lbl}</button>
              ))}
              <button onClick={()=>{
                const reset={...cfg,fields:{...cfg.fields,[cfg.formType]:{...cfg.fields[cfg.formType],[selField]:{...FORM_CONFIGS[cfg.formType].fields[selField]}}}};
                saveCfg(reset);
              }} style={{padding:'4px 10px',background:'#f59e0b',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontSize:11}}>↩️ 초기화</button>
            </div>
          )}
        </div>

        {/* 안내 */}
        <div style={{background:'#f0fdf4',borderTop:'1px solid #bbf7d0',padding:'7px 14px',fontSize:11,color:'#065f46'}}>
          💡 사진 업로드 시 AI가 번호판을 자동으로 인식합니다. 인식이 안 되면 직접 입력하세요.
          <br/>여러 차량은 쉼표(,)로 구분해서 한 번에 입력 가능합니다.
        </div>
      </div>
    </div>
  );
}

export default VehicleCertPrint;
