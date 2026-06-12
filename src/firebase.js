import { initializeApp } from 'firebase/app';
import { getAuth }       from 'firebase/auth';
import { getFirestore }  from 'firebase/firestore';

// Firebase 설정
const firebaseConfig = {
  apiKey:            "AIzaSyCeLMJuvDo8f6a3qo_IU9a678pobUma_Uw",
  authDomain:        "customer-pl.firebaseapp.com",
  projectId:         "customer-pl",
  storageBucket:     "customer-pl.firebasestorage.app",
  messagingSenderId: "1051503799392",
  appId:             "1:1051503799392:web:25b8fd7398651ed6de2705",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export { firebaseConfig };
export default app;
