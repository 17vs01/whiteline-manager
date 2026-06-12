// =============================================
// pesticideUtils.js — 사용약제 관련 유틸리티
// Firestore 컬렉션:
//   pesticideTypes/{id}              → 약제 마스터 (설정에서 등록)
//   customerPesticides/{customerCode} → 고객별 약제 내역
// =============================================
import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

// ── 약제 마스터 목록 불러오기 ─────────────────
export const loadPesticideTypes = async () => {
  try {
    const snap = await getDocs(collection(db, 'pesticideTypes'));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  } catch (e) {
    console.warn('약제 목록 로드 실패:', e);
    return [];
  }
};

// ── 고객별 저장된 약제 정보 불러오기 ──────────
export const loadCustomerPesticides = async (customerCode) => {
  try {
    const docSnap = await getDoc(doc(db, 'customerPesticides', String(customerCode)));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (e) {
    console.warn('고객 약제 정보 로드 실패:', e);
    return null;
  }
};

// ── 고객별 약제 정보 저장 ──────────────────────
export const saveCustomerPesticides = async (customerCode, customerName, pesticides) => {
  await setDoc(doc(db, 'customerPesticides', String(customerCode)), {
    customerCode: String(customerCode),
    customerName,
    pesticides,   // [{ typeId, name, unit, amount }]
    updatedAt: new Date().toISOString()
  });
};

// ── 약제 선택 팝업 ────────────────────────────
// options.required = true  → 건너뛰기 불가, 미선택 시 완료 차단
// options.subTitle         → 추가 안내문구
// 반환값: 선택된 약제 배열 | null (건너뛰기/취소)
export const showPesticidePopup = async (customerCode, customerName, options = {}) => {
  // 하위 호환: 세 번째 인자가 문자열이면 subTitle로 처리
  if (typeof options === 'string') options = { subTitle: options };
  const { required = false, subTitle = '' } = options;

  // 로딩
  Swal.fire({ title: '약제 정보 불러오는 중...', allowOutsideClick: false,
    didOpen: () => Swal.showLoading() });

  const [types, existing] = await Promise.all([
    loadPesticideTypes(),
    loadCustomerPesticides(customerCode)
  ]);
  Swal.close();

  // 기존 약제 맵 { typeId → amount } — amount > 0 인 것만
  const existingMap = {};
  (existing?.pesticides || []).forEach(p => {
    if (p.amount && Number(p.amount) > 0) {
      existingMap[p.typeId] = p.amount;
    }
  });

  // ── 필수 안내 배너 ──
  const requiredBanner = required ? `
    <div style="margin-bottom:10px;padding:10px 12px;background:#fee2e2;
      border:1.5px solid #fca5a5;border-radius:8px;font-size:12px;color:#991b1b;">
      🔒 <b>약제 기입 필수</b> — 이 고객은 소독증명서 출력 대상입니다.<br>
      <span style="font-size:11px;">최소 1가지 약제를 선택해야 완료 처리됩니다.</span>
    </div>` : '';

  // ── 약제 목록 HTML ──
  let listHtml = '';
  if (types.length === 0) {
    listHtml = `
      <div style="color:#b45309;padding:12px;background:#fef3c7;border-radius:8px;
        font-size:13px;text-align:center;">
        ⚠️ 등록된 사용약제가 없습니다.<br>
        <span style="font-size:11px;color:#78350f;">
          설정 &gt; 사용약제 관리에서 먼저 등록해주세요.
        </span>
      </div>
      ${required ? `<div style="margin-top:8px;font-size:12px;color:#dc2626;text-align:center;">
        ⚠️ 약제를 등록한 후 완료 처리하세요.</div>` : ''}`;
  } else {
    listHtml = `<div style="max-height:300px;overflow-y:auto;margin-top:4px;">`;
    types.forEach(t => {
      const savedAmt = existingMap[t.id] ?? 0;
      const isChecked = savedAmt && Number(savedAmt) > 0;
      listHtml += `
        <div class="pest-row" id="pest-row-${t.id}"
          style="display:flex;align-items:center;gap:8px;padding:9px 10px;
            border-bottom:1px solid #f1f5f9;border-radius:6px;margin-bottom:2px;
            background:${isChecked ? '#f0fdf4' : '#fff'};
            border:1px solid ${isChecked ? '#86efac' : '#f1f5f9'};">
          <div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;
            background:${isChecked ? '#10b981' : '#d1d5db'};
            transition:background 0.2s;" id="pest-dot-${t.id}"></div>
          <label style="flex:1;font-size:13px;font-weight:${isChecked ? 'bold' : 'normal'};
            color:${isChecked ? '#065f46' : '#374151'};cursor:default;" id="pest-label-${t.id}">
            ${t.name}
          </label>
          <input type="number" id="pamt-${t.id}"
            value="${isChecked ? savedAmt : ''}"
            placeholder="0" min="0" step="1"
            onwheel="this.blur()"
            oninput="(function(el){
              var row=document.getElementById('pest-row-${t.id}');
              var dot=document.getElementById('pest-dot-${t.id}');
              var lbl=document.getElementById('pest-label-${t.id}');
              var on=el.value&&parseFloat(el.value)>0;
              row.style.background=on?'#f0fdf4':'#fff';
              row.style.border='1px solid '+(on?'#86efac':'#f1f5f9');
              dot.style.background=on?'#10b981':'#d1d5db';
              lbl.style.fontWeight=on?'bold':'normal';
              lbl.style.color=on?'#065f46':'#374151';
            })(this)"
            style="width:75px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;
              font-size:14px;text-align:right;background:white;">
          <span style="font-size:12px;color:#6b7280;width:28px;flex-shrink:0;
            text-align:left;">${t.unit}</span>
        </div>`;
    });
    listHtml += `</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:6px;">
        💡 수량을 입력하면 자동으로 선택됩니다. 0 또는 빈칸이면 저장 안 됩니다.
      </div>`;
  }

  const result = await Swal.fire({
    title: required ? '🔒 사용약제 기입 (필수)' : '🧪 사용약제 확인',
    html: `
      <div style="text-align:left;">
        ${requiredBanner}
        <div style="font-size:12px;color:#555;margin-bottom:8px;padding:8px;
          background:#f8fafc;border-radius:6px;">
          고객: <b>${customerName}</b>
          ${subTitle ? `<span style="color:#f59e0b;font-size:11px;margin-left:6px;">${subTitle}</span>` : ''}
        </div>
        ${listHtml}
      </div>`,
    showCancelButton: true,
    confirmButtonText: types.length > 0 ? '💾 저장 후 완료' : '확인',
    // 필수일 때는 "건너뛰기" 텍스트를 "취소 (완료 불가)"로 변경
    cancelButtonText: required ? '❌ 취소 (완료 안 됨)' : '건너뛰기',
    confirmButtonColor: '#10b981',
    cancelButtonColor: required ? '#dc2626' : '#6b7280',
    width: '400px',
    allowOutsideClick: !required,   // 필수이면 바깥 클릭 불가
    allowEscapeKey:    !required,   // 필수이면 ESC 불가
    preConfirm: () => {
      if (types.length === 0) {
        if (required) {
          Swal.showValidationMessage('⚠️ 약제를 먼저 설정에서 등록해주세요.');
          return false;
        }
        return [];
      }
      // 수량 > 0 인 항목만 선택된 것으로 처리 (체크박스 없음)
      const selected = types.filter(t => {
        const val = parseFloat(document.getElementById(`pamt-${t.id}`)?.value);
        return val && val > 0;
      });
      // 필수인데 아무것도 입력 안 했으면 차단
      if (required && selected.length === 0) {
        Swal.showValidationMessage('⚠️ 최소 1가지 약제의 수량을 입력해야 완료됩니다.');
        return false;
      }
      return selected.map(t => ({
        typeId: t.id,
        name:   t.name,
        unit:   t.unit,
        amount: parseFloat(document.getElementById(`pamt-${t.id}`)?.value) || 0
      }));
    }
  });

  if (result.isConfirmed) {
    if (types.length > 0 && result.value.length > 0) {
      try {
        await saveCustomerPesticides(customerCode, customerName, result.value);
      } catch (e) {
        console.warn('약제 저장 실패:', e);
      }
    }
    return result.value;
  }
  // 취소/건너뛰기: required이면 null 반환 → 호출부에서 완료 차단
  return null;
};
