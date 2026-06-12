// =============================================
// 구획/모니터링 메인 페이지
// 탭: 구획관리 | 트랩설치 | 월별점검 | 보고서
// =============================================
import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import {
  getAreas, addArea, updateArea, deleteArea,
  getTrapsByArea, getNextTrapNumber, addTrap, updateTrap, deleteTrap, getAllTraps,
} from './pestFirestore';
import {
  AREA_LEVELS, AREA_TYPES, TRAP_TYPES, TRAP_STATUS, TRAP_CATEGORY, TRAFFIC_SCORE,
  getAreaTypeInfo, getAreaLevelInfo, getTrapTypeInfo, scoreToKey,
} from './pestConstants';
import PestMonthlyEntry from './PestMonthlyEntry';
import PestReportView   from './PestReportView';

const S = {
  card:     { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  row:      { display: 'flex', alignItems: 'center', gap: 8 },
  btn:      (c='#3b82f6') => ({ padding: '8px 16px', background: c, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }),
  btnSm:    (c='#3b82f6') => ({ padding: '5px 10px', background: c, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }),
  btnGhost: { padding: '7px 12px', background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  input:    { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' },
  section:  { fontSize: 15, fontWeight: 'bold', color: '#1e293b', marginBottom: 10 },
  crumb:    { fontSize: 13, color: '#6b7280', marginBottom: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  crumbLink:{ cursor: 'pointer', color: '#3b82f6', textDecoration: 'underline' },
  empty:    { textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 },
  badge:    (c, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 'bold', color: c, background: bg || c + '22' }),
};

function Breadcrumb({ items }) {
  return (
    <div style={S.crumb}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: '#d1d5db' }}>›</span>}
          {item.onClick
            ? <span style={S.crumbLink} onClick={item.onClick}>{item.label}</span>
            : <span style={{ color: '#1e293b', fontWeight: 'bold' }}>{item.label}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// 고객사 목록
// ─────────────────────────────────────────
function ClientListView({ onSelect }) {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    getDocs(collection(db, 'customers')).then(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.custStatus !== '해약' && c.custStatus !== '삭제')
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCustomers(list);
      setLoading(false);
    });
  }, []);

  const filtered = customers.filter(c =>
    (c.name || '').includes(search) || (c.code || '').includes(search)
  );

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.section}>🪳 구획/모니터링</div>
        <input style={S.input} placeholder="고객사 검색 (이름 또는 코드)"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading ? <div style={S.empty}>불러오는 중...</div>
        : filtered.length === 0 ? <div style={S.empty}>검색 결과 없음</div>
        : filtered.map(c => (
          <div key={c.id} onClick={() => onSelect(c)}
            style={{ ...S.card, cursor: 'pointer', ...S.row }}>
            <div style={{ fontSize: 26 }}>🏢</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', fontSize: 15 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                {c.address || '주소 없음'}
              </div>
            </div>
            <span style={{ color: '#d1d5db', fontSize: 20 }}>›</span>
          </div>
        ))}
    </div>
  );
}

// ─────────────────────────────────────────
// 구획 트리 아이템 (재귀)
// ─────────────────────────────────────────
function AreaTreeItem({ area, allAreas, depth, onSelect, onAdd, onDelete, selectedId }) {
  const [open, setOpen] = useState(depth < 2);
  const children  = allAreas.filter(a => a.parentId === area.id)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const typeInfo  = getAreaTypeInfo(area.type);
  const levelInfo = getAreaLevelInfo(area.level);
  const nextLevelIdx = AREA_LEVELS.findIndex(l => l.value === area.level) + 1;
  const nextLevel = AREA_LEVELS[nextLevelIdx]?.value || null;
  const isSelected = selectedId === area.id;

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', marginLeft: depth * 14,
        borderRadius: 8, marginBottom: 3, cursor: 'pointer',
        background: isSelected ? '#eff6ff' : '#fff',
        border: isSelected ? '1.5px solid #3b82f6' : '1px solid #f1f5f9',
      }}>
        <span style={{ width: 14, textAlign: 'center', color: '#9ca3af', fontSize: 11 }}
          onClick={() => setOpen(o => !o)}>
          {children.length > 0 ? (open ? '▼' : '▶') : '·'}
        </span>
        <span style={{ fontSize: 15 }}>{typeInfo.icon}</span>
        <div style={{ flex: 1 }} onClick={() => onSelect(area)}>
          <span style={{ fontWeight: isSelected ? 'bold' : 'normal', fontSize: 13 }}>{area.name}</span>
          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 5 }}>
            {levelInfo.label}{area.locationCount ? ` · ${area.locationCount}개소` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 3 }} onClick={e => e.stopPropagation()}>
          {nextLevel && <button style={S.btnSm('#6b7280')} onClick={() => onAdd(area, nextLevel)}>+</button>}
          <button style={S.btnSm('#ef4444')} onClick={() => onDelete(area)}>×</button>
        </div>
      </div>
      {open && children.map(child => (
        <AreaTreeItem key={child.id} area={child} allAreas={allAreas}
          depth={depth + 1} onSelect={onSelect} onAdd={onAdd}
          onDelete={onDelete} selectedId={selectedId} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// 구획 관리 탭
// ─────────────────────────────────────────
function AreaTab({ client }) {
  const [areas, setAreas]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAreas(await getAreas(client.id));
    setLoading(false);
  }, [client.id]);

  useEffect(() => { load(); }, [load]);

  const openAreaForm = async (parentArea = null, level = null) => {
    const defaultLevel = level || (parentArea
      ? AREA_LEVELS[AREA_LEVELS.findIndex(l => l.value === parentArea.level) + 1]?.value || 'location'
      : 'building');
    const levelInfo = getAreaLevelInfo(defaultLevel);

    const { value } = await Swal.fire({
      title: parentArea ? `${parentArea.name} 하위 ${levelInfo.label} 추가` : '구획 추가',
      html: `
        ${!parentArea ? `<select id="a-level" class="swal2-input">
          ${AREA_LEVELS.map(l => `<option value="${l.value}" ${l.value === defaultLevel ? 'selected' : ''}>${l.icon} ${l.label}</option>`).join('')}
        </select>` : ''}
        <select id="a-type" class="swal2-input">
          ${AREA_TYPES.map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
        </select>
        <input id="a-name" class="swal2-input" placeholder="구획명 (예: 본관, 주방, 1층)">
        <input id="a-count" class="swal2-input" type="number" placeholder="개소 수 (선택)" min="1">
        <input id="a-memo" class="swal2-input" placeholder="메모 (선택)">
      `,
      showCancelButton: true, confirmButtonText: '추가', cancelButtonText: '취소',
      preConfirm: () => {
        const name = document.getElementById('a-name').value.trim();
        if (!name) { Swal.showValidationMessage('구획명을 입력하세요'); return false; }
        return {
          level: parentArea ? defaultLevel : document.getElementById('a-level').value,
          type: document.getElementById('a-type').value,
          name,
          parentId: parentArea?.id || null,
          locationCount: parseInt(document.getElementById('a-count').value) || null,
          memo: document.getElementById('a-memo').value.trim() || null,
        };
      },
    });
    if (!value) return;
    await addArea(client.id, value);
    load();
  };

  const handleDelete = async (area) => {
    const childCount = areas.filter(a => a.parentId === area.id).length;
    const result = await Swal.fire({
      title: '구획 삭제', icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: '삭제', cancelButtonText: '취소',
      text: childCount > 0
        ? `"${area.name}" 및 하위 ${childCount}개 구획과 트랩이 모두 삭제됩니다.`
        : `"${area.name}"을(를) 삭제할까요?`,
    });
    if (!result.isConfirmed) return;
    await deleteArea(client.id, area.id, areas);
    setSelectedId(null);
    load();
  };

  const roots = areas.filter(a => !a.parentId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ ...S.section, margin: 0, flex: 1 }}>📁 구획 관리</div>
        <button style={S.btn()} onClick={() => openAreaForm()}>+ 구획 추가</button>
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>
        💡 한번 만든 구획은 영구적으로 유지됩니다. 하위 구획은 각 구획의 [+] 버튼으로 추가하세요.
      </div>
      {loading ? <div style={S.empty}>불러오는 중...</div>
        : areas.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📁</div>
            <div>등록된 구획이 없습니다</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>건물 → 분류 → 층 → 장소 순으로 만드세요</div>
          </div>
        ) : (
          <div style={S.card}>
            {roots.map(area => (
              <AreaTreeItem key={area.id} area={area} allAreas={areas}
                depth={0} selectedId={selectedId}
                onSelect={(a) => setSelectedId(a.id)}
                onAdd={openAreaForm}
                onDelete={handleDelete} />
            ))}
          </div>
        )}
    </div>
  );
}

// ─────────────────────────────────────────
// 트랩 설치 탭 — 구획별 트랩 영구 관리
// ─────────────────────────────────────────
function TrapTab({ client }) {
  const [areas, setAreas]   = useState([]);
  const [traps, setTraps]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | monitoring | uv | bait

  const load = useCallback(async () => {
    setLoading(true);
    const [areasData, trapsData] = await Promise.all([
      getAreas(client.id), getAllTraps(client.id),
    ]);
    setAreas(areasData);
    setTraps(trapsData);
    setLoading(false);
  }, [client.id]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (areaId) => {
    const areaName = areas.find(a => a.id === areaId)?.name || '';
    const typeOpts = TRAP_TYPES.map(t =>
      `<option value="${t.value}" data-prefix="${t.prefix}" data-category="${t.category}">${t.icon} ${t.label} (${t.prefix})</option>`
    ).join('');
    const { value } = await Swal.fire({
      title: `트랩 추가 — ${areaName}`,
      html: `
        <select id="t-type" class="swal2-input">${typeOpts}</select>
        <input id="t-memo" class="swal2-input" placeholder="위치 설명 (예: 출입문 우측)">
      `,
      showCancelButton: true, confirmButtonText: '추가', cancelButtonText: '취소',
      preConfirm: async () => {
        const typeVal = document.getElementById('t-type').value;
        const sel     = document.querySelector('#t-type option:checked');
        const prefix  = sel?.getAttribute('data-prefix') || 'OT';
        const number  = await getNextTrapNumber(client.id, areaId, typeVal, prefix);
        return { type: typeVal, number, areaId, memo: document.getElementById('t-memo').value.trim() || null };
      },
    });
    if (!value) return;
    await addTrap(client.id, value);
    load();
  };

  const handleDelete = async (trap) => {
    const result = await Swal.fire({
      title: '트랩 삭제', text: `"${trap.number}" 을(를) 삭제할까요?`,
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: '삭제', cancelButtonText: '취소',
    });
    if (!result.isConfirmed) return;
    await deleteTrap(client.id, trap.id);
    load();
  };

  const handleStatusChange = async (trap) => {
    const opts = Object.entries(TRAP_STATUS).map(([k, v]) =>
      `<option value="${k}" ${trap.status === k ? 'selected' : ''}>${v.label}</option>`
    ).join('');
    const { value } = await Swal.fire({
      title: `${trap.number} 상태`,
      html: `<select id="ts" class="swal2-input">${opts}</select>`,
      showCancelButton: true, confirmButtonText: '저장', cancelButtonText: '취소',
      preConfirm: () => ({ status: document.getElementById('ts').value }),
    });
    if (!value) return;
    await updateTrap(client.id, trap.id, value);
    load();
  };

  // 구획별 + 카테고리 필터
  const locationAreas = areas.filter(a => a.level === 'location').length > 0
    ? areas.filter(a => a.level === 'location')
    : areas;
  const displayAreas = locationAreas.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const filterTraps = (t) => {
    if (filter === 'all') return true;
    return TRAP_CATEGORY[filter]?.includes(t.type);
  };

  // 카테고리 레이블 + 색상
  const catInfo = {
    all:        { label: '전체', color: '#374151' },
    monitoring: { label: '모니터링트랩', color: '#3b82f6' },
    uv:         { label: 'UV포충등',     color: '#f59e0b' },
    bait:       { label: '베이트/쥐먹이', color: '#8b5cf6' },
  };

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 10 }}>
        <div style={{ ...S.section, margin: 0, flex: 1 }}>📋 트랩 설치 관리</div>
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>
        💡 트랩 설치 정보는 영구 유지됩니다. 월별 포획 기록은 [월별 점검] 탭에서 입력하세요.
      </div>

      {/* 카테고리 필터 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {Object.entries(catInfo).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${filter === k ? v.color : '#e5e7eb'}`,
            background: filter === k ? v.color + '15' : '#fff',
            color: filter === k ? v.color : '#6b7280', cursor: 'pointer', fontSize: 12, fontWeight: filter === k ? 'bold' : 'normal',
          }}>{v.label}</button>
        ))}
      </div>

      {loading ? <div style={S.empty}>불러오는 중...</div>
        : displayAreas.map(area => {
          const areaTraps = traps.filter(t => t.areaId === area.id && filterTraps(t))
            .sort((a, b) => (a.number || '').localeCompare(b.number || ''));
          const allAreaTraps = traps.filter(t => t.areaId === area.id);
          if (filter !== 'all' && areaTraps.length === 0) return null;

          return (
            <div key={area.id} style={S.card}>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{getAreaTypeInfo(area.type).icon}</span>
                <span style={{ fontWeight: 'bold', flex: 1 }}>{area.name}</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>총 {allAreaTraps.length}개</span>
                <button style={S.btnSm()} onClick={() => handleAdd(area.id)}>+ 트랩 추가</button>
              </div>

              {areaTraps.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af', padding: '4px 0' }}>
                  {filter === 'all' ? '설치된 트랩 없음' : '해당 카테고리 트랩 없음'}
                </div>
              ) : areaTraps.map(trap => {
                const ti = getTrapTypeInfo(trap.type);
                const st = TRAP_STATUS[trap.status] || TRAP_STATUS.normal;
                return (
                  <div key={trap.id} style={{ ...S.row, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 16 }}>{ti.icon}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 'bold', fontSize: 13 }}>{trap.number}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>{ti.label}</span>
                      {trap.memo && <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>— {trap.memo}</span>}
                    </div>
                    <span style={{ ...S.badge(st.color, st.bg), fontSize: 11 }}>{st.label}</span>
                    <button style={S.btnSm('#6b7280')} onClick={() => handleStatusChange(trap)}>상태</button>
                    <button style={S.btnSm('#ef4444')} onClick={() => handleDelete(trap)}>삭제</button>
                  </div>
                );
              })}
            </div>
          );
        })}

      {traps.length === 0 && !loading && (
        <div style={S.empty}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <div>설치된 트랩이 없습니다</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>각 구역에서 [+ 트랩 추가] 를 눌러 등록하세요</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 고객사 홈 — 4개 탭
// ─────────────────────────────────────────
function ClientHomeView({ client, currentUser, onBack }) {
  const [tab, setTab] = useState('area');

  const tabs = [
    { id: 'area',    icon: '📁', label: '구획관리' },
    { id: 'trap',    icon: '📋', label: '트랩설치' },
    { id: 'monthly', icon: '📅', label: '월별점검' },
    { id: 'report',  icon: '📊', label: '보고서' },
  ];

  return (
    <div>
      <Breadcrumb items={[
        { label: '고객사 목록', onClick: onBack },
        { label: client.name },
      ]} />

      {/* 탭 */}
      <div style={{ display: 'flex', background: '#fff', borderRadius: 10, marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer', fontSize: 11,
            fontWeight: 'bold', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            borderBottom: `3px solid ${tab === t.id ? '#3b82f6' : 'transparent'}`,
            color: tab === t.id ? '#3b82f6' : '#6b7280', background: '#fff',
          }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'area'    && <AreaTab    client={client} />}
      {tab === 'trap'    && <TrapTab    client={client} />}
      {tab === 'monthly' && <PestMonthlyEntry client={client} currentUser={currentUser} />}
      {tab === 'report'  && <PestReportView   client={client} currentUser={currentUser} />}
    </div>
  );
}

// ─────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────
function PestMonitoringPage({ currentUser }) {
  const [view,   setView]   = useState('client');
  const [client, setClient] = useState(null);

  return (
    <div style={{ padding: '0 0 20px' }}>
      {view === 'client' && (
        <ClientListView onSelect={(c) => { setClient(c); setView('home'); }} />
      )}
      {view === 'home' && client && (
        <ClientHomeView
          client={client}
          currentUser={currentUser}
          onBack={() => setView('client')}
        />
      )}
    </div>
  );
}

export default PestMonitoringPage;
