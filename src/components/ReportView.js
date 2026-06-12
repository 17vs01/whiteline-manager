import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// URL에서 리포트 ID 추출
const getReportIdFromUrl = () => {
  const path = window.location.pathname;
  if (path.startsWith('/report/')) {
    return path.replace('/report/', '');
  }
  return null;
};

function ReportView() {
  const reportId = getReportIdFromUrl();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const reportDoc = await getDoc(doc(db, 'reports', reportId));
        if (reportDoc.exists()) {
          setReport({ id: reportDoc.id, ...reportDoc.data() });
        } else {
          setError('리포트를 찾을 수 없습니다.');
        }
      } catch (err) {
        console.error('리포트 로드 오류:', err);
        setError('리포트를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };

    if (reportId) {
      fetchReport();
    }
  }, [reportId]);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh',
        background: '#f3f4f6'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>📋</div>
          <div style={{ color: '#666' }}>리포트 로딩중...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh',
        background: '#f3f4f6'
      }}>
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>❌</div>
          <div style={{ color: '#ef4444', fontWeight: 'bold' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
      padding: '20px'
    }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ 
          background: '#fff', 
          borderRadius: '16px', 
          padding: '20px',
          marginBottom: '16px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '15px' }}>
            <div style={{ fontSize: '14px', color: '#666' }}>화이트라인 해충방제</div>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#1e40af', marginTop: '5px' }}>
              작업 리포트
            </div>
          </div>
          
          <div style={{ 
            background: '#dbeafe', 
            padding: '15px', 
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e40af' }}>
              🏢 {report.customerName}
            </div>
            <div style={{ fontSize: '14px', color: '#3b82f6', marginTop: '8px' }}>
              📅 {report.date}
            </div>
            <div style={{ 
              fontSize: '16px', 
              fontWeight: 'bold', 
              color: '#059669', 
              marginTop: '8px',
              background: '#dcfce7',
              padding: '8px',
              borderRadius: '8px'
            }}>
              ⏰ {report.startTime} ~ {report.endTime} ({report.duration}분)
            </div>
          </div>
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginTop: '15px',
            fontSize: '13px',
            color: '#666'
          }}>
            <div>👤 담당: {report.staffName}</div>
            <div>📝 작성: {new Date(report.createdAt).toLocaleDateString('ko-KR')}</div>
          </div>
        </div>

        {/* 구역별 리포트 */}
        {report.zones?.map((zone, zIdx) => (
          <div key={zIdx} style={{ 
            background: '#fff', 
            borderRadius: '16px', 
            padding: '16px',
            marginBottom: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}>
            <div style={{ 
              fontSize: '16px', 
              fontWeight: 'bold', 
              color: '#1e40af',
              paddingBottom: '10px',
              borderBottom: '2px solid #3b82f6',
              marginBottom: '12px'
            }}>
              📍 {zIdx + 1}. {zone.name}
            </div>

            {zone.subZones?.map((subZone, szIdx) => (
              <div key={szIdx} style={{ 
                background: '#f8fafc', 
                padding: '12px', 
                borderRadius: '10px',
                marginBottom: '10px',
                borderLeft: '3px solid #3b82f6'
              }}>
                <div style={{ 
                  fontSize: '13px', 
                  fontWeight: 'bold', 
                  color: '#374151',
                  marginBottom: '10px'
                }}>
                  {zone.subZones.length > 1 ? `└ ${subZone.name}` : subZone.name}
                </div>

                {/* 트랩 포획 */}
                {(subZone.traps?.rat > 0 || subZone.traps?.roach > 0 || subZone.traps?.pheromone > 0) && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>🪤 트랩 포획</div>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                      {subZone.traps?.rat > 0 && <span>쥐: {subZone.traps.rat}</span>}
                      {subZone.traps?.roach > 0 && <span>바퀴: {subZone.traps.roach}</span>}
                      {subZone.traps?.pheromone > 0 && <span>페로몬: {subZone.traps.pheromone}</span>}
                    </div>
                  </div>
                )}

                {/* 포충기 포획 */}
                {Object.values(subZone.lightTrap || {}).some(v => v > 0) && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>💡 포충기 포획</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                      {subZone.lightTrap?.fly > 0 && <span>파리: {subZone.lightTrap.fly}</span>}
                      {subZone.lightTrap?.moth > 0 && <span>나방: {subZone.lightTrap.moth}</span>}
                      {subZone.lightTrap?.mothfly > 0 && <span>나방파리: {subZone.lightTrap.mothfly}</span>}
                      {subZone.lightTrap?.mayfly > 0 && <span>하루살이: {subZone.lightTrap.mayfly}</span>}
                      {subZone.lightTrap?.fruitfly > 0 && <span>초파리: {subZone.lightTrap.fruitfly}</span>}
                      {subZone.lightTrap?.mosquito > 0 && <span>모기: {subZone.lightTrap.mosquito}</span>}
                      {subZone.lightTrap?.other > 0 && <span>기타: {subZone.lightTrap.other}</span>}
                    </div>
                  </div>
                )}

                {/* 발견 해충 */}
                {(subZone.pests?.roach?.count > 0 || subZone.pests?.rat?.count > 0 || subZone.pests?.others?.length > 0) && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>🪳 발견 해충</div>
                    <div style={{ fontSize: '12px' }}>
                      {subZone.pests?.roach?.count > 0 && (
                        <div>바퀴({subZone.pests.roach.type}): {subZone.pests.roach.count}마리</div>
                      )}
                      {subZone.pests?.rat?.count > 0 && (
                        <div>쥐({subZone.pests.rat.type}): {subZone.pests.rat.count}마리</div>
                      )}
                      {subZone.pests?.others?.length > 0 && (
                        <div>기타: {subZone.pests.others.join(', ')}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* 작업 내용 */}
                {subZone.work?.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>🔧 작업 내용</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {subZone.work.map((w, i) => (
                        <span key={i} style={{
                          background: '#dbeafe',
                          color: '#1e40af',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px'
                        }}>
                          ✓ {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 메모 */}
                {subZone.memo && (
                  <div style={{ 
                    background: '#fef3c7', 
                    padding: '8px', 
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#92400e'
                  }}>
                    📝 {subZone.memo}
                  </div>
                )}

                {/* 데이터 없음 표시 */}
                {!subZone.traps?.rat && !subZone.traps?.roach && !subZone.traps?.pheromone &&
                 !Object.values(subZone.lightTrap || {}).some(v => v > 0) &&
                 !subZone.pests?.roach?.count && !subZone.pests?.rat?.count &&
                 !subZone.pests?.others?.length && !subZone.work?.length && !subZone.memo && (
                  <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center' }}>
                    ✅ 이상 없음
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* 푸터 */}
        <div style={{ 
          textAlign: 'center', 
          padding: '20px',
          color: '#9ca3af',
          fontSize: '12px'
        }}>
          <div>화이트라인 해충방제</div>
          <div style={{ marginTop: '5px' }}>📞 문의: 010-XXXX-XXXX</div>
        </div>
      </div>
    </div>
  );
}

export default ReportView;
