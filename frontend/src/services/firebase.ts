import { initializeApp, getApps, getApp } from 'firebase/app';
import { getApiBaseUrl } from './api';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

// Configure robust session persistence for browser, Android Webview and Capacitor
try {
  setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
    setPersistence(firebaseAuth, indexedDBLocalPersistence).catch(console.warn);
  });
} catch (persistErr) {
  console.warn('Firebase persistence initialization warning:', persistErr);
}

export const firebaseDb = getFirestore(firebaseApp);
export const firebaseStorage = getStorage(firebaseApp);

/**
 * Compresses an image file before generating a Data URL fallback.
 * Scales down to max 1280px and applies JPEG compression to guarantee
 * the resulting Data URL is small (~80KB - 160KB) and safely within
 * Cloud Firestore's 1MB document limit.
 */
const compressImageToDataUrl = (file: File, maxDim = 1280, quality = 0.75): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === 'image/png' && file.size < 400 * 1024 ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve(dataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

/**
 * Uploads a chat attachment with fallback mechanisms.
 * Tries Firebase Storage first, then backend multipart upload, then DataURL with image compression.
 */
export const uploadChatAttachment = async (
  file: File,
  orgId: string,
  convId: string,
  onProgress?: (progress: number) => void
): Promise<{ name: string; url: string; size: number; type: string }> => {
  if (onProgress) onProgress(20);

  // 1. Try Firebase Storage
  if (firebaseStorage) {
    try {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `chat_attachments/${orgId}/${convId}/${Date.now()}_${sanitizedName}`;
      const fileStorageRef = storageRef(firebaseStorage, filePath);
      
      if (onProgress) onProgress(45);
      await uploadBytes(fileStorageRef, file, {
        contentType: file.type || 'application/octet-stream',
      });
      if (onProgress) onProgress(85);
      
      const downloadUrl = await getDownloadURL(fileStorageRef);
      if (onProgress) onProgress(100);
      return {
        name: file.name,
        url: downloadUrl,
        size: file.size,
        type: file.type || 'application/octet-stream',
      };
    } catch (storageErr) {
      console.warn('Firebase Storage upload notice, trying backend upload:', storageErr);
    }
  }

  // 2. Try Backend Node upload (/api/attachments/upload)
  try {
    if (onProgress) onProgress(60);
    const formData = new FormData();
    formData.append('file', file);
    
    let token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (!token && firebaseAuth.currentUser) {
      try {
        token = await firebaseAuth.currentUser.getIdToken();
      } catch (e) {}
    }
    const apiBase = getApiBaseUrl();
    const uploadUrl = apiBase ? `${apiBase}/api/attachments/upload` : '/api/attachments/upload';
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Organization-Id': orgId,
      },
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      if (onProgress) onProgress(100);
      return {
        name: file.name,
        url: data.fileUrl || data.url,
        size: file.size,
        type: file.type || 'application/octet-stream',
      };
    }
  } catch (backendErr) {
    console.warn('Backend attachment upload notice, using client data URL fallback:', backendErr);
  }

  // 3. Resilient Base64 Data URL fallback (auto-compressing images to stay strictly below Firestore's 1MB limit)
  const isImg = file.type.startsWith('image/') || Boolean(file.name.match(/\.(png|jpe?g|webp|gif|svg|bmp)$/i));
  if (isImg) {
    try {
      const compressedDataUrl = await compressImageToDataUrl(file);
      if (onProgress) onProgress(100);
      return {
        name: file.name,
        url: compressedDataUrl,
        size: Math.round(compressedDataUrl.length * 0.75),
        type: 'image/jpeg',
      };
    } catch (compErr) {
      console.warn('Image canvas compression notice:', compErr);
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (onProgress) onProgress(100);
      resolve({
        name: file.name,
        url: reader.result as string,
        size: file.size,
        type: file.type || 'application/octet-stream',
      });
    };
    reader.onerror = () => {
      resolve({
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
        type: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  });
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const signInWithGoogle = () => signInWithPopup(firebaseAuth, googleProvider);

export const signInWithEmailPassword = (email: string, pass: string) => 
  signInWithEmailAndPassword(firebaseAuth, email, pass);

export const fetchFirestoreUserDoc = async (uid: string) => {
  try {
    const userDocRef = doc(firebaseDb, 'users', uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (err) {
    console.error('Error fetching Firestore user document users/' + uid, err);
  }
  return null;
};

export const upsertFirestoreUserDoc = async (uid: string, data: Record<string, any>) => {
  try {
    const userDocRef = doc(firebaseDb, 'users', uid);
    await setDoc(userDocRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('Error writing Firestore user document users/' + uid, err);
    return false;
  }
};

export const deleteFirestoreUserDoc = async (uid: string) => {
  try {
    const userDocRef = doc(firebaseDb, 'users', uid);
    await deleteDoc(userDocRef);
    return true;
  } catch (err) {
    console.error('Error deleting Firestore user document users/' + uid, err);
    return false;
  }
};

export const sendResetPasswordEmail = (email: string) => sendPasswordResetEmail(firebaseAuth, email, {
  url: `${window.location.origin}/reset-password`,
  handleCodeInApp: true,
});

export const verifyResetCode = (oobCode: string) => verifyPasswordResetCode(firebaseAuth, oobCode);

export const resetPasswordWithCode = (oobCode: string, newPassword: string) => confirmPasswordReset(firebaseAuth, oobCode, newPassword);

export const fetchFirestoreUsersByOrg = async (orgId: string): Promise<any[]> => {
  if (!orgId) return [];
  try {
    const q = query(collection(firebaseDb, 'users'), where('organizationId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      uid: d.id,
      ...d.data()
    }));
  } catch (err) {
    console.error(`Error fetching Firestore users for org ${orgId}:`, err);
    return [];
  }
};

export const fetchAllFirestoreUserDocs = async (orgId?: string): Promise<any[]> => {
  if (orgId) {
    return fetchFirestoreUsersByOrg(orgId);
  }
  console.warn('fetchAllFirestoreUserDocs called without orgId. Organization isolation enforced.');
  return [];
};

export const fetchOrganizationDoc = async (orgId: string): Promise<any | null> => {
  try {
    const orgDocRef = doc(firebaseDb, 'organizations', orgId);
    const snap = await getDoc(orgDocRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }
    return null;
  } catch (err) {
    console.error(`Error fetching organization ${orgId}:`, err);
    return null;
  }
};

export const fetchUserOrgMemberships = async (uid: string, email?: string): Promise<any[]> => {
  try {
    const memberships: any[] = [];
    const seenOrgIds = new Set<string>();

    const q = query(collection(firebaseDb, 'organizationMembers'), where('userId', '==', uid));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data();
      if (data.organizationId && !seenOrgIds.has(data.organizationId)) {
        seenOrgIds.add(data.organizationId);
        memberships.push({ id: d.id, ...data });
      }
    });

    if (email && memberships.length === 0) {
      const qEmail = query(collection(firebaseDb, 'organizationMembers'), where('userEmail', '==', email.trim().toLowerCase()));
      const snapEmail = await getDocs(qEmail);
      snapEmail.forEach((d) => {
        const data = d.data();
        if (data.organizationId && !seenOrgIds.has(data.organizationId)) {
          seenOrgIds.add(data.organizationId);
          memberships.push({ id: d.id, ...data });
        }
      });
    }

    // Enrich with organization document
    const enriched: any[] = [];
    for (const m of memberships) {
      const orgDoc = await fetchOrganizationDoc(m.organizationId);
      enriched.push({
        ...m,
        organizationName: orgDoc?.name || m.organizationName || m.organizationId,
        organizationCode: orgDoc?.code || m.organizationId,
        organizationLogo: orgDoc?.logo || null,
        organizationStatus: orgDoc?.status || 'active',
      });
    }

    return enriched;
  } catch (err) {
    console.error('Error fetching user organization memberships:', err);
    return [];
  }
};

// =========================================================================
// FIRESTORE PROJECTS & TASKS PERSISTENCE HELPERS
// =========================================================================

export const fetchFirestoreProjects = async (orgId?: string): Promise<any[]> => {
  if (!orgId) {
    console.warn('fetchFirestoreProjects called without orgId. Organization isolation enforced.');
    return [];
  }
  try {
    const q = query(collection(firebaseDb, 'projects'), where('organizationId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error fetching Firestore projects:', err);
    return [];
  }
};

export const fetchFirestoreTasks = async (orgId?: string, projectId?: string): Promise<any[]> => {
  if (!orgId) {
    console.warn('fetchFirestoreTasks called without orgId. Organization isolation enforced.');
    return [];
  }
  try {
    let q;
    if (projectId) {
      q = query(collection(firebaseDb, 'tasks'), where('organizationId', '==', orgId), where('projectId', '==', projectId));
    } else {
      q = query(collection(firebaseDb, 'tasks'), where('organizationId', '==', orgId));
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error fetching Firestore tasks:', err);
    return [];
  }
};

export const upsertFirestoreProject = async (projectId: string, data: Record<string, any>): Promise<boolean> => {
  try {
    const docRef = doc(firebaseDb, 'projects', String(projectId));
    await setDoc(docRef, {
      ...data,
      id: String(projectId),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  } catch (err) {
    console.error(`Error saving Firestore project ${projectId}:`, err);
    return false;
  }
};

export const upsertFirestoreTask = async (taskId: string, data: Record<string, any>): Promise<boolean> => {
  try {
    const docRef = doc(firebaseDb, 'tasks', String(taskId));
    await setDoc(docRef, {
      ...data,
      id: String(taskId),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  } catch (err) {
    console.error(`Error saving Firestore task ${taskId}:`, err);
    return false;
  }
};

export const deleteFirestoreProjectDoc = async (projectId: string): Promise<boolean> => {
  try {
    const docRef = doc(firebaseDb, 'projects', String(projectId));
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    console.error(`Error deleting Firestore project ${projectId}:`, err);
    return false;
  }
};

export const deleteFirestoreTaskDoc = async (taskId: string): Promise<boolean> => {
  try {
    const docRef = doc(firebaseDb, 'tasks', String(taskId));
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    console.error(`Error deleting Firestore task ${taskId}:`, err);
    return false;
  }
};

export const fetchFirestoreAuditLogs = async (orgId?: string): Promise<any[]> => {
  if (!orgId) {
    console.warn('fetchFirestoreAuditLogs called without orgId. Organization isolation enforced.');
    return [];
  }
  try {
    const q = query(collection(firebaseDb, 'audit_logs'), where('organizationId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, any>) }));
  } catch (err) {
    console.error('Error fetching Firestore audit logs:', err);
    return [];
  }
};

export const createFirestoreAuditLogDoc = async (data: Record<string, any>): Promise<boolean> => {
  try {
    const now = new Date();
    const docRef = doc(collection(firebaseDb, 'audit_logs'));
    await setDoc(docRef, {
      ...data,
      id: docRef.id,
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    return true;
  } catch (err) {
    console.error('Error writing Firestore audit log doc:', err);
    return false;
  }
};

export const fetchFirestoreNotifications = async (userId: string): Promise<any[]> => {
  try {
    const q = query(collection(firebaseDb, 'notifications'), where('userId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, any>) }));
  } catch (err) {
    console.error('Error fetching Firestore notifications:', err);
    return [];
  }
};



