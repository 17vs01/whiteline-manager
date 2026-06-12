import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [staffList, setStaffList] = useState([]);
  const [settings, setSettings] = useState({
    companyName: '화이트라인',
    companyLogo: '',
    anthropicApiKey: '',
    priceStep: 1000,
    equipmentList: [],
    overtimeHour: 10,
    overtimeMinute: 0,
    overtimeEnabled: true,
    aiAssignEnabled: true,
    fallbackOption: 'waiting',
    companyAddress: '',
    companyCeo: '',
    sealImage: '',
    certLogo: '',
    startTab: 'calendar',
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // settings 한 번만 fetch — 모든 컴포넌트가 이걸 공유해서 씀
  const fetchSettings = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'settings'));
      if (snap.docs.length > 0) {
        const data = snap.docs[0].data();
        setSettings(prev => ({
          ...prev,
          companyName:     data.companyName     || '화이트라인',
          companyLogo:     data.companyLogo     || '',
          anthropicApiKey: data.anthropicApiKey || '',
          priceStep:       data.priceStep       || 1000,
          equipmentList:   data.equipmentList   || [],
          overtimeHour:    data.overtimeHour    ?? 10,
          overtimeMinute:  data.overtimeMinute  ?? 0,
          overtimeEnabled: data.overtimeEnabled ?? true,
          aiAssignEnabled: data.aiAssignEnabled ?? true,
          fallbackOption:  data.fallbackOption  || 'waiting',
          companyAddress:  data.companyAddress  || '',
          companyCeo:      data.companyCeo      || '',
          sealImage:       data.sealImage       || '',
          certLogo:        data.certLogo        || '',
          startTab:        data.startTab        || 'calendar',
        }));
      }
    } catch (e) {
      console.error('설정 로드 오류:', e);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  // staffList fetch
  const fetchStaffList = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'staff'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStaffList(list);
      return list;
    } catch (e) {
      console.error('직원 목록 로드 오류:', e);
      return [];
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <AppContext.Provider value={{
      staffList, setStaffList,
      settings, setSettings,
      settingsLoaded,
      fetchStaffList,
      fetchSettings,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext는 AppProvider 안에서 사용해야 합니다.');
  return ctx;
}
