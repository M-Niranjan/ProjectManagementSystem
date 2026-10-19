import { create } from 'zustand';
import api from '../services/api';
import {
  firebaseAuth,
  fetchFirestoreUserDoc,
  upsertFirestoreUserDoc,
  sendResetPasswordEmail,
  verifyResetCode,
  resetPasswordWithCode,
  fetchUserOrgMemberships,
  signInWithEmailPassword,
} from '../services/firebase';
import { normalizeRole } from '../services/authRoles';
import { useUIStore } from './useUIStore';

export interface OrgMembership {
  id?: string;
  organizationId: string;
  organizationName: string;
  organizationCode?: string;
  organizationLogo?: string | null;
  role: string;
  roleCode: 'ROLE_ADMIN' | 'ROLE_MANAGER' | 'ROLE_EMPLOYEE' | string;
  status?: string;
  department?: string;
  designation?: string;
}

export interface Organization {
  id: string;
  name: string;
  code?: string;
  description?: string;
  logo?: string | null;
  status?: string;
  memberCount?: number;
}

interface User {
  id: number;
  uid?: string;
  email: string;
  name: string;
  role: 'ROLE_ADMIN' | 'ROLE_MANAGER' | 'ROLE_EMPLOYEE';
  employeeId?: string;
  designation?: string;
  department?: string;
  experience?: number;
  skills?: string;
  gender?: 'Male' | 'Female' | 'Other' | string;
  profilePhoto?: string;
  phone?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  bio?: string;
  education?: string;
  resumeBase64?: string;
  resumeFileName?: string;
  organizationId?: string;
  organizationName?: string;
  status?: string;
  preferences?: any;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;

  // Multi-Organization State
  orgMemberships: OrgMembership[];
  activeOrganizationId: string | null;
  activeOrganization: OrgMembership | null;
  activeOrgRole: 'ROLE_ADMIN' | 'ROLE_MANAGER' | 'ROLE_EMPLOYEE' | null;

  setActiveOrganization: (orgId: string) => Promise<boolean>;
  switchOrganization: (orgId: string) => Promise<boolean>;
  fetchMyOrganizations: () => Promise<OrgMembership[]>;

  login: (credentials: any, rememberMe?: boolean) => Promise<boolean>;
  loginWithFirebase: (firebaseUser: { uid: string; email: string | null; displayName: string | null; photoURL: string | null; getIdToken?: () => Promise<string> } | any, rememberMe?: boolean, workspaceCode?: string) => Promise<boolean>;
  register: (userDetails: any) => Promise<boolean>;
  registerOrganization: (data: { organizationName: string; industry?: string; organizationEmail: string; adminName: string; adminEmail: string; password: string; confirmPassword?: string }) => Promise<{ success: boolean; organization?: any; user?: any; message?: string }>;
  logout: () => void;
  updateProfile: (profileData: any) => Promise<boolean>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; message: string }>;
  confirmResetPassword: (oobCode: string, newPassword: string) => Promise<{ success: boolean; message: string }>;
  requestOtp: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyOtp: (email: string, otp: string) => Promise<{ success: boolean; message: string }>;
  resetPasswordWithOtp: (email: string, otp: string, newPassword: string) => Promise<{ success: boolean; message: string }>;
  initAuth: () => Promise<void>;
  clearError: () => void;
}

const getInitialUser = (): User | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('auth_user') || localStorage.getItem('mock_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getInitialToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token') || sessionStorage.getItem('token') || null;
};

const getInitialOrgMemberships = (): OrgMembership[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('org_memberships');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const getInitialOrgId = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('active_org_id') || sessionStorage.getItem('active_org_id') || null;
};

const getInitialActiveOrg = (): OrgMembership | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('active_org');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthState>((set, get) => {
  // Listen for the custom logout event from the API interceptor
  if (typeof window !== 'undefined') {
    window.addEventListener('auth-logout', () => {
      localStorage.removeItem('auth_user');
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      localStorage.removeItem('active_org_id');
      localStorage.removeItem('active_org');
      localStorage.removeItem('org_memberships');
      sessionStorage.removeItem('active_org_id');
      set({
        user: null,
        token: null,
        error: null,
        orgMemberships: [],
        activeOrganizationId: null,
        activeOrganization: null,
        activeOrgRole: null,
        loading: false,
      });
      window.location.hash = '#/';
    });
  }

  const initialUser = getInitialUser();
  const initialToken = getInitialToken();
  const initialOrgMemberships = getInitialOrgMemberships();
  const initialOrgId = getInitialOrgId();
  const initialActiveOrg = getInitialActiveOrg();

  return {
    user: initialUser,
    token: initialToken,
    loading: true, // Keep loading true initially until session is verified!
    error: null,

    // Multi-organization state
    orgMemberships: initialOrgMemberships,
    activeOrganizationId: initialOrgId,
    activeOrganization: initialActiveOrg,
    activeOrgRole: initialActiveOrg ? (normalizeRole(initialActiveOrg.roleCode || initialActiveOrg.role) as any) : null,

    clearError: () => set({ error: null }),

    initAuth: async () => {
      set({ loading: true });

      try {
        // 1. Wait for Firebase Auth to initialize with session persistence
        const firebaseUser = await new Promise<any>((resolve) => {
          if (firebaseAuth.currentUser) {
            resolve(firebaseAuth.currentUser);
            return;
          }
          const unsubscribe = firebaseAuth.onAuthStateChanged((u) => {
            unsubscribe();
            resolve(u);
          });
          // Generous timeout to allow network resolution on mobile devices
          setTimeout(() => {
            resolve(firebaseAuth.currentUser);
          }, 3500);
        });

        if (!firebaseUser) {
          const savedToken = getInitialToken();

          if (savedToken) {
            try {
              const meRes = await api.get('/api/auth/me', { timeout: 3500 });
              if (meRes.data && (meRes.data.id || meRes.data.email)) {
                const roleEnum = normalizeRole(meRes.data.role);
                if (roleEnum) {
                  const verifiedUser: User = {
                    id: meRes.data.id,
                    uid: String(meRes.data.uid || meRes.data.id),
                    email: meRes.data.email,
                    name: meRes.data.name || (meRes.data.email ? meRes.data.email.split('@')[0] : 'User'),
                    role: roleEnum,
                    designation: meRes.data.designation || (roleEnum === 'ROLE_ADMIN' ? 'System Administrator' : roleEnum === 'ROLE_MANAGER' ? 'Project Lead' : 'Software Engineer'),
                    department: meRes.data.department || (roleEnum === 'ROLE_ADMIN' ? 'Executive' : roleEnum === 'ROLE_MANAGER' ? 'Management' : 'Engineering'),
                    experience: meRes.data.experience || 5,
                    skills: meRes.data.skills || '',
                    gender: meRes.data.gender || 'Male',
                    profilePhoto: meRes.data.profilePhoto,
                    phone: meRes.data.phone,
                    githubUrl: meRes.data.githubUrl,
                    portfolioUrl: meRes.data.portfolioUrl,
                    bio: meRes.data.bio,
                    education: meRes.data.education,
                    createdAt: meRes.data.createdAt || new Date().toISOString(),
                  };

                  let memberships: OrgMembership[] = meRes.data.orgMemberships || getInitialOrgMemberships();
                  let currentOrgId = getInitialOrgId();
                  let currentOrg = getInitialActiveOrg();

                  if (memberships && memberships.length > 0) {
                    localStorage.setItem('org_memberships', JSON.stringify(memberships));
                    if (memberships.length === 1) {
                      currentOrgId = memberships[0].organizationId;
                      currentOrg = memberships[0];
                      localStorage.setItem('active_org_id', currentOrgId);
                      localStorage.setItem('active_org', JSON.stringify(currentOrg));
                    } else if (currentOrgId && memberships.some((m) => m.organizationId === currentOrgId)) {
                      currentOrg = memberships.find((m) => m.organizationId === currentOrgId) || null;
                      if (currentOrg) localStorage.setItem('active_org', JSON.stringify(currentOrg));
                    }
                  }

                  localStorage.setItem('auth_user', JSON.stringify(verifiedUser));
                  set({
                    user: verifiedUser,
                    token: savedToken,
                    orgMemberships: memberships,
                    activeOrganizationId: currentOrgId,
                    activeOrganization: currentOrg,
                    activeOrgRole: currentOrg ? (normalizeRole(currentOrg.roleCode || currentOrg.role) as any) : null,
                    loading: false,
                    error: null,
                  });
                  return;
                }
              }
            } catch (meErr: any) {
              console.warn('[Auth] Backend session restore fallback:', meErr?.message);
              if (get().user && get().token) {
                set({ loading: false });
                return;
              }
            }
          }

          // If session is absent, clear storage
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('token');
            localStorage.removeItem('token');
            localStorage.removeItem('auth_user');
            localStorage.removeItem('mock_user');
            localStorage.removeItem('active_org_id');
            localStorage.removeItem('active_org');
            localStorage.removeItem('org_memberships');
          }
          set({
            user: null,
            token: null,
            loading: false,
            error: null,
          });
          return;
        }

        // Firebase user authenticated!
        let userData = await fetchFirestoreUserDoc(firebaseUser.uid);

        if (!userData) {
          try {
            const meRes = await api.get('/api/auth/me', { timeout: 3500 });
            if (meRes.data && (meRes.data.id || meRes.data.email)) {
              userData = meRes.data;
            }
          } catch (_fallbackErr) {}
        }

        if (!userData) {
          console.warn('[Auth] User document not found in Firestore for UID:', firebaseUser.uid);
          set({
            user: null,
            token: null,
            loading: false,
            error: null,
          });
          return;
        }

        // Fetch memberships from Firestore
        let memberships: OrgMembership[] = [];
        try {
          memberships = await fetchUserOrgMemberships(firebaseUser.uid, firebaseUser.email || undefined);
        } catch (_orgErr) {}

        // Fallback: If memberships is empty but userDoc has organizationId
        if (memberships.length === 0 && (userData as any).organizationId) {
          const orgId = (userData as any).organizationId;
          memberships = [{
            id: `${orgId}_${firebaseUser.uid}`,
            organizationId: orgId,
            organizationName: (userData as any).organizationName || orgId,
            organizationCode: (userData as any).organizationCode || orgId,
            role: (userData as any).role || 'employee',
            roleCode: (userData as any).roleCode || ((userData as any).role === 'admin' ? 'ROLE_ADMIN' : (userData as any).role === 'teamLeader' ? 'ROLE_MANAGER' : 'ROLE_EMPLOYEE'),
            status: (userData as any).status || 'active',
          }];
        }

        let currentOrgId = getInitialOrgId();
        let currentOrg: OrgMembership | null = null;

        if (memberships.length === 1) {
          // Exactly one organization: Automatically select and enter!
          currentOrgId = memberships[0].organizationId;
          currentOrg = memberships[0];
          localStorage.setItem('active_org_id', currentOrgId);
          localStorage.setItem('active_org', JSON.stringify(currentOrg));
          sessionStorage.setItem('active_org_id', currentOrgId);
        } else if (memberships.length > 1) {
          // Multiple organizations: check if remembered org is valid for this user
          if (currentOrgId && memberships.some((m) => m.organizationId === currentOrgId)) {
            currentOrg = memberships.find((m) => m.organizationId === currentOrgId) || null;
            if (currentOrg) {
              localStorage.setItem('active_org', JSON.stringify(currentOrg));
              sessionStorage.setItem('active_org_id', currentOrgId);
            }
          } else {
            currentOrgId = null;
            currentOrg = null;
            localStorage.removeItem('active_org_id');
            localStorage.removeItem('active_org');
            sessionStorage.removeItem('active_org_id');
          }
        }

        localStorage.setItem('org_memberships', JSON.stringify(memberships));

        // Strict role resolution: active organization role > Firestore user role
        const rawRole = currentOrg 
          ? (currentOrg.roleCode || currentOrg.role)
          : ((userData as any).roleCode ?? (userData as any).role);
        const roleEnum = normalizeRole(rawRole);

        if (!roleEnum) {
          set({
            user: null,
            token: null,
            loading: false,
            error: 'Invalid user role. Please contact your administrator.',
          });
          return;
        }

        const activeUser: User = {
          id: firebaseUser.uid as any,
          uid: firebaseUser.uid,
          email: firebaseUser.email || (userData as any).email || '',
          name:
            (userData as any).name ||
            (userData as any).displayName ||
            firebaseUser.displayName ||
            (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'User'),
          role: roleEnum,
          designation:
            (userData as any).designation ||
            (roleEnum === 'ROLE_ADMIN'
              ? 'System Administrator'
              : roleEnum === 'ROLE_MANAGER'
                ? 'Project Lead'
                : 'Software Engineer'),
          department:
            (userData as any).department ||
            (roleEnum === 'ROLE_ADMIN'
              ? 'Executive'
              : roleEnum === 'ROLE_MANAGER'
                ? 'Management'
                : 'Engineering'),
          experience: (userData as any).experience || 5,
          skills: (userData as any).skills || '',
          gender: (userData as any).gender || 'Male',
          profilePhoto: (firebaseUser.photoURL && !firebaseUser.photoURL.includes('unsplash.com')) ? firebaseUser.photoURL : ((userData as any).profilePhoto && !(userData as any).profilePhoto.includes('unsplash.com')) ? (userData as any).profilePhoto : undefined,
          createdAt: (userData as any).createdAt || new Date().toISOString(),
        };

        const fbToken = await firebaseUser.getIdToken();
        localStorage.setItem('auth_user', JSON.stringify(activeUser));
        localStorage.setItem('token', fbToken);

        set({
          user: activeUser,
          token: fbToken,
          orgMemberships: memberships,
          activeOrganizationId: currentOrgId,
          activeOrganization: currentOrg,
          activeOrgRole: currentOrg ? (normalizeRole(currentOrg.roleCode || currentOrg.role) as any) : roleEnum,
          loading: false,
          error: null,
        });
        return;
      } catch (err: any) {
        console.warn('[Auth] Session background check error:', err?.message);
        set({ loading: false });
      }
    },

    setActiveOrganization: async (orgId: string) => {
      let memberships = get().orgMemberships;
      if (!memberships || memberships.length === 0) {
        memberships = await get().fetchMyOrganizations();
      }
      const target = memberships.find((m) => m.organizationId === orgId);
      if (!target) return false;

      const orgRole = normalizeRole(target.roleCode || target.role) as any;
      localStorage.setItem('active_org_id', orgId);
      localStorage.setItem('active_org', JSON.stringify(target));
      sessionStorage.setItem('active_org_id', orgId);

      // Synchronize both activeOrgRole and user.role so RoleGuard stays consistent
      const currentUser = get().user;
      const updatedUser = currentUser ? { ...currentUser, role: orgRole } : null;
      if (updatedUser) {
        localStorage.setItem('auth_user', JSON.stringify(updatedUser));
      }

      // Attempt to refresh token with backend for new organization context
      try {
        const switchRes = await api.post('/api/organizations/switch', { organizationId: orgId });
        if (switchRes.data && switchRes.data.token) {
          localStorage.setItem('token', switchRes.data.token);
          set({ token: switchRes.data.token });
        }
      } catch (_e) {}

      // Purge cached communication metadata of other organizations
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('pms_conv_meta_') || key.startsWith('pms_chat_cache_'))) {
            if (!key.includes(orgId)) {
              keysToRemove.push(key);
            }
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (_e) {}

      try {
        useUIStore.getState().hideToast();
        useUIStore.getState().setSignOutModalOpen(false);
      } catch (_e) {}

      set({
        user: updatedUser,
        activeOrganizationId: orgId,
        activeOrganization: target,
        activeOrgRole: orgRole,
      });
      return true;
    },

    switchOrganization: async (orgId: string) => {
      return get().setActiveOrganization(orgId);
    },

    fetchMyOrganizations: async () => {
      try {
        const res = await api.get('/api/organizations');
        if (res.data && res.data.organizations) {
          const orgs = res.data.organizations as OrgMembership[];
          localStorage.setItem('org_memberships', JSON.stringify(orgs));
          set({ orgMemberships: orgs });
          return orgs;
        }
      } catch (_e) {}

      const currentUser = get().user;
      if (currentUser?.uid) {
        const orgs = await fetchUserOrgMemberships(currentUser.uid, currentUser.email);
        if (orgs.length > 0) {
          localStorage.setItem('org_memberships', JSON.stringify(orgs));
          set({ orgMemberships: orgs });
          return orgs;
        }
      }
      return get().orgMemberships;
    },

    login: async (credentials, rememberMe = true) => {
      set({ loading: true, error: null });
      try {
        const response = await api.post('/api/auth/login', credentials);
        const { accessToken, user, orgMemberships, activeOrganizationId, activeOrgRole } = response.data;

        sessionStorage.setItem('token', accessToken);
        if (rememberMe) {
          localStorage.setItem('token', accessToken);
        }
        const resolvedUid = user?.uid || (typeof user?.id === 'string' && isNaN(Number(user?.id)) ? user.id : (firebaseAuth.currentUser?.uid || String(user?.id || '')));
        const userWithUid = {
          ...user,
          uid: resolvedUid,
        };
        localStorage.setItem('auth_user', JSON.stringify(userWithUid));

        const memberships: OrgMembership[] = orgMemberships || [];
        localStorage.setItem('org_memberships', JSON.stringify(memberships));

        const initialSavedOrgId = getInitialOrgId();
        let activeOrg: OrgMembership | null = null;
        if (activeOrganizationId) {
          activeOrg = memberships.find((m) => m.organizationId === activeOrganizationId) || null;
        } else if (memberships.length === 1) {
          activeOrg = memberships[0];
        } else if (memberships.length > 1 && initialSavedOrgId && memberships.some((m) => m.organizationId === initialSavedOrgId)) {
          activeOrg = memberships.find((m) => m.organizationId === initialSavedOrgId) || null;
        }

        if (activeOrg) {
          localStorage.setItem('active_org_id', activeOrg.organizationId);
          localStorage.setItem('active_org', JSON.stringify(activeOrg));
          sessionStorage.setItem('active_org_id', activeOrg.organizationId);
        } else {
          localStorage.removeItem('active_org_id');
          localStorage.removeItem('active_org');
          sessionStorage.removeItem('active_org_id');
        }

        const resolvedOrgRole = activeOrg ? (normalizeRole(activeOrgRole || activeOrg.roleCode || activeOrg.role) as any) : null;

        try {
          useUIStore.getState().hideToast();
          useUIStore.getState().setSignOutModalOpen(false);
        } catch (_e) {}

        set({
          token: accessToken,
          user,
          orgMemberships: memberships,
          activeOrganizationId: activeOrg ? activeOrg.organizationId : null,
          activeOrganization: activeOrg,
          activeOrgRole: resolvedOrgRole,
          loading: false,
        });
        return true;
      } catch (err: any) {
        const errorData = err.response?.data;
        let message = errorData?.message || errorData || 'Failed to authenticate user';
        if (typeof message === 'string' && (message.includes('<!DOCTYPE html>') || message.includes('<html>'))) {
          message = 'Backend server returned an error. Please ensure the backend is running.';
        }
        set({ error: typeof message === 'string' ? message : JSON.stringify(message), loading: false });
        return false;
      }
    },

    loginWithFirebase: async (firebaseUser, rememberMe = true, workspaceCode?: string) => {
      set({ loading: true, error: null });
      try {
        let user: User | null = null;
        let token = `firebase:${firebaseUser.uid}`;
        let memberships: OrgMembership[] = [];
        let serverActiveOrgId: string | null = null;
        let serverActiveOrgRole: string | null = null;

        try {
          const fbToken = await firebaseUser.getIdToken?.();
          const res = await api.post(
            '/api/auth/firebase-login',
            {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              workspaceCode: workspaceCode || undefined,
            },
            {
              headers: fbToken ? { Authorization: `Bearer ${fbToken}` } : undefined,
            }
          );
          if (res.data) {
            user = res.data.user;
            token = res.data.accessToken || token;
            memberships = res.data.orgMemberships || [];
            serverActiveOrgId = res.data.activeOrganizationId || null;
            serverActiveOrgRole = res.data.activeOrgRole || null;
          }
        } catch (apiErr: any) {
          // If backend denied access (403 forbidden or 401 unauthorized), strictly reject!
          if (apiErr.response?.status === 403 || apiErr.response?.status === 401) {
            const msg = apiErr.response?.data?.message || 'Access Denied: You do not have authorization to access this workspace.';
            set({ error: msg, loading: false });
            return false;
          }
          console.warn('Backend firebase-login sync warning:', apiErr?.message);
        }

        if (!user) {
          const emailLower = (firebaseUser.email || '').trim().toLowerCase();
          const userDoc = await fetchFirestoreUserDoc(firebaseUser.uid);
          const rawRole = userDoc?.roleCode || userDoc?.role;
          const role = normalizeRole(rawRole);
          if (!role) {
            set({ error: 'Your account role could not be verified. Please contact your administrator.', loading: false });
            return false;
          }

          user = {
            id: firebaseUser.uid as any,
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || userDoc?.name || emailLower.split('@')[0] || 'User',
            email: emailLower,
            role,
            designation: userDoc?.designation || (role === 'ROLE_ADMIN' ? 'System Administrator' : role === 'ROLE_MANAGER' ? 'Project Lead' : 'Software Engineer'),
            department: userDoc?.department || (role === 'ROLE_ADMIN' ? 'Administration' : role === 'ROLE_MANAGER' ? 'Management' : 'Engineering'),
            experience: userDoc?.experience || 5,
            skills: userDoc?.skills || 'Project Management, Collaboration',
            gender: userDoc?.gender || 'Male',
            profilePhoto: (firebaseUser.photoURL && !firebaseUser.photoURL.includes('unsplash.com')) ? firebaseUser.photoURL : userDoc?.profilePhoto,
            createdAt: userDoc?.createdAt || new Date().toISOString(),
          };
        }

        // If memberships were not returned by backend API, query client Firestore
        if (memberships.length === 0) {
          try {
            memberships = await fetchUserOrgMemberships(firebaseUser.uid, firebaseUser.email || undefined);
          } catch (_e) {}
        }

        if (!memberships || memberships.length === 0) {
          set({
            error: 'This account has not been approved for a TaskFlow organization. Please contact your administrator.',
            loading: false,
          });
          return false;
        }

        localStorage.setItem('org_memberships', JSON.stringify(memberships));

        const initialSavedOrgId = getInitialOrgId();
        let activeOrgId: string | null = serverActiveOrgId;
        let activeOrg: OrgMembership | null = null;

        if (activeOrgId) {
          activeOrg = memberships.find((m) => m.organizationId === activeOrgId) || null;
        } else if (memberships.length === 1) {
          activeOrgId = memberships[0].organizationId;
          activeOrg = memberships[0];
        } else if (memberships.length > 1 && initialSavedOrgId && memberships.some((m) => m.organizationId === initialSavedOrgId)) {
          activeOrgId = initialSavedOrgId;
          activeOrg = memberships.find((m) => m.organizationId === initialSavedOrgId) || null;
        }

        if (activeOrg) {
          localStorage.setItem('active_org_id', activeOrg.organizationId);
          localStorage.setItem('active_org', JSON.stringify(activeOrg));
          sessionStorage.setItem('active_org_id', activeOrg.organizationId);
        } else {
          localStorage.removeItem('active_org_id');
          localStorage.removeItem('active_org');
          sessionStorage.removeItem('active_org_id');
        }

        const activeRole = activeOrg 
          ? (normalizeRole(serverActiveOrgRole || activeOrg.roleCode || activeOrg.role || user.role) as any)
          : (normalizeRole(user.role) as any);

        const storage = rememberMe ? localStorage : sessionStorage;
        storage.setItem('token', token);
        localStorage.setItem('auth_user', JSON.stringify({ ...user, role: activeRole || user.role }));
        try {
          useUIStore.getState().hideToast();
          useUIStore.getState().setSignOutModalOpen(false);
        } catch (_e) {}

        set({
          token,
          user: { ...user, role: activeRole || user.role },
          orgMemberships: memberships,
          activeOrganizationId: activeOrg ? activeOrg.organizationId : null,
          activeOrganization: activeOrg,
          activeOrgRole: activeRole,
          loading: false,
          error: null,
        });
        return true;
      } catch (err: any) {
        console.error('Firebase session setup failed', err);
        set({ error: err.message || 'Unable to create your workspace session.', loading: false });
        return false;
      }
    },

    register: async (userDetails) => {
      set({ loading: true, error: null });
      try {
        const response = await api.post('/api/auth/register', userDetails);
        const { accessToken, user, orgMemberships, activeOrganizationId, activeOrgRole } = response.data;

        localStorage.setItem('token', accessToken);
        sessionStorage.setItem('token', accessToken);
        localStorage.setItem('auth_user', JSON.stringify(user));

        const memberships: OrgMembership[] = orgMemberships || [];
        localStorage.setItem('org_memberships', JSON.stringify(memberships));

        let activeOrg: OrgMembership | null = null;
        if (activeOrganizationId) {
          activeOrg = memberships.find((m) => m.organizationId === activeOrganizationId) || null;
          if (activeOrg) {
            localStorage.setItem('active_org_id', activeOrganizationId);
            localStorage.setItem('active_org', JSON.stringify(activeOrg));
            sessionStorage.setItem('active_org_id', activeOrganizationId);
          }
        }

        set({
          token: accessToken,
          user,
          orgMemberships: memberships,
          activeOrganizationId: activeOrg ? activeOrg.organizationId : null,
          activeOrganization: activeOrg,
          activeOrgRole: (normalizeRole(activeOrgRole || activeOrg?.roleCode || user.role) as any),
          loading: false,
        });
        return true;
      } catch (err: any) {
        const msg = err.response?.data?.message || 'Failed to create account.';
        set({ error: msg, loading: false });
        return false;
      }
    },

    registerOrganization: async (data) => {
      set({ loading: true, error: null });
      try {
        const response = await api.post('/api/organizations/register', data);
        const { accessToken, user, organization, orgMemberships, activeOrganizationId, activeOrgRole } = response.data;

        let clientToken = accessToken;
        // Sign into client Firebase Auth to activate browserLocalPersistence
        try {
          if (data.adminEmail && data.password) {
            const userCred = await signInWithEmailPassword(data.adminEmail, data.password);
            if (userCred.user) {
              clientToken = await userCred.user.getIdToken();
            }
          }
        } catch (fbSignErr: any) {
          console.warn('[registerOrganization] Client Firebase sign in warning:', fbSignErr?.message);
        }

        if (clientToken) {
          sessionStorage.setItem('token', clientToken);
          localStorage.setItem('token', clientToken);
        }
        if (user) {
          localStorage.setItem('auth_user', JSON.stringify(user));
        }

        const memberships: OrgMembership[] = orgMemberships || (organization ? [{
          organizationId: organization.id,
          organizationName: organization.name,
          organizationCode: organization.code,
          role: 'admin',
          roleCode: 'ROLE_ADMIN',
          status: 'active',
        }] : []);

        localStorage.setItem('org_memberships', JSON.stringify(memberships));

        const activeOrg = memberships[0] || null;
        if (activeOrg) {
          localStorage.setItem('active_org_id', activeOrg.organizationId);
          localStorage.setItem('active_org', JSON.stringify(activeOrg));
          sessionStorage.setItem('active_org_id', activeOrg.organizationId);
        }

        set({
          token: accessToken || null,
          user: user || null,
          orgMemberships: memberships,
          activeOrganizationId: activeOrg ? activeOrg.organizationId : null,
          activeOrganization: activeOrg,
          activeOrgRole: 'ROLE_ADMIN',
          loading: false,
          error: null,
        });

        return {
          success: true,
          organization,
          user,
          message: response.data.message || 'Organization created successfully 🎉',
        };
      } catch (err: any) {
        const errorData = err.response?.data;
        let message = errorData?.message || errorData?.error || err.message || 'Failed to register organization.';
        if (typeof message === 'string' && (message.includes('<!DOCTYPE html>') || message.includes('<html>'))) {
          message = 'Backend server returned an error. Please ensure the backend is running.';
        }
        set({ error: typeof message === 'string' ? message : JSON.stringify(message), loading: false });
        return { success: false, message };
      }
    },

    logout: () => {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('mock_user');
      localStorage.removeItem('active_org_id');
      localStorage.removeItem('active_org');
      localStorage.removeItem('org_memberships');
      sessionStorage.removeItem('active_org_id');

      // Purge all organization-specific communication and conversation caches
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('pms_conv_meta_') || key.startsWith('pms_chat_cache_') || key.startsWith('pms_comm_'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (_e) {}

      try {
        useUIStore.getState().hideToast();
        useUIStore.getState().setSignOutModalOpen(false);
      } catch (_e) {}

      void firebaseAuth.signOut();
      set({
        user: null,
        token: null,
        error: null,
        orgMemberships: [],
        activeOrganizationId: null,
        activeOrganization: null,
        activeOrgRole: null,
        loading: false,
      });
      window.location.hash = '#/';
    },

    updateProfile: async (profileData) => {
      set({ error: null });
      try {
        const response = await api.put('/api/users/profile', profileData);
        const updatedUser = response.data;
        localStorage.setItem('auth_user', JSON.stringify(updatedUser));
        set({ user: updatedUser });

        const currentUser = get().user;
        const uid = currentUser?.uid || String(currentUser?.id);
        if (uid) {
          await upsertFirestoreUserDoc(uid, profileData).catch(() => {});
        }
        return true;
      } catch (err: any) {
        console.warn('Backend profile update fallback to Firestore:', err);
        const currentUser = get().user;
        if (currentUser) {
          const updatedUser = { ...currentUser, ...profileData };
          localStorage.setItem('auth_user', JSON.stringify(updatedUser));
          set({ user: updatedUser });
          const uid = currentUser.uid || String(currentUser.id);
          if (uid) {
            await upsertFirestoreUserDoc(uid, profileData).catch(() => {});
          }
          return true;
        }
        let message = err.response?.data?.message || err.response?.data || 'Failed to update profile';
        if (typeof message === 'string' && (message.includes('<!DOCTYPE html>') || message.includes('<html>'))) {
          message = 'Backend server returned an error. Please verify your connection.';
        }
        set({ error: typeof message === 'string' ? message : JSON.stringify(message) });
        return false;
      }
    },

    requestPasswordReset: async (email: string) => {
      const cleanEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return { success: false, message: 'Please enter a valid email address.' };
      }
      try {
        await sendResetPasswordEmail(cleanEmail);
        return { success: true, message: 'Password reset email sent. Please check your inbox, Spam, or Promotions folder.' };
      } catch (err: any) {
        console.error('Firebase password reset request failed:', err);
        const code = err?.code || '';
        if (code === 'auth/user-not-found') {
          return { success: false, message: 'No user account found with this email address.' };
        } else if (code === 'auth/invalid-email') {
          return { success: false, message: 'Please enter a valid email address.' };
        } else if (code === 'auth/too-many-requests') {
          return { success: false, message: 'Too many requests. Please wait a moment and try again.' };
        } else if (code === 'auth/network-request-failed') {
          return { success: false, message: 'Network error. Please check your internet connection.' };
        }
        if (code === 'auth/operation-not-allowed') {
          return { success: false, message: 'Password reset is not available right now. Please contact support.' };
        }
        if (code === 'auth/invalid-continue-uri' || code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-api-key') {
          return { success: false, message: 'Password reset is not configured correctly. Please contact support.' };
        }
        return { success: false, message: 'We could not send the password reset email. Please try again later.' };
      }
    },

    confirmResetPassword: async (oobCode: string, newPassword: string) => {
      const cleanPass = newPassword.trim();
      if (!cleanPass || cleanPass.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters long.' };
      }
      try {
        await resetPasswordWithCode(oobCode, cleanPass);
        return { success: true, message: 'Password changed successfully. You can now sign in with your new password.' };
      } catch (err: any) {
        console.error('Firebase password reset confirmation failed:', err);
        const code = err?.code || '';
        if (code === 'auth/expired-action-code') {
          return { success: false, message: 'The password reset link has expired. Please request a new reset link.' };
        } else if (code === 'auth/invalid-action-code') {
          return { success: false, message: 'The password reset link is invalid or has already been used.' };
        } else if (code === 'auth/weak-password') {
          return { success: false, message: 'The password is too weak. Please choose a stronger password.' };
        }

        return { success: false, message: 'Unable to change your password. Please request a new reset link and try again.' };
      }
    },

    requestOtp: async (email: string) => {
      const cleanEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return { success: false, message: 'Please enter a valid email address.' };
      }
      try {
        const response = await api.post('/api/auth/forgot-password', { email: cleanEmail });
        return { success: true, message: response.data.message || '6-digit OTP sent to your email address!' };
      } catch (err: any) {
        const msg = err.response?.data?.message || err.response?.data || 'Failed to send OTP code. Please check your email and try again.';
        return { success: false, message: typeof msg === 'string' ? msg : JSON.stringify(msg) };
      }
    },

    verifyOtp: async (email: string, otp: string) => {
      const cleanEmail = email.trim();
      const cleanOtp = otp.trim();
      if (!cleanOtp || cleanOtp.length !== 6) {
        return { success: false, message: 'Please enter a valid 6-digit OTP code.' };
      }
      try {
        const response = await api.post('/api/auth/verify-otp', { email: cleanEmail, otp: cleanOtp });
        return { success: true, message: response.data.message || 'OTP verified successfully!' };
      } catch (err: any) {
        const msg = err.response?.data?.message || err.response?.data || 'Incorrect or expired OTP code. Please try again.';
        return { success: false, message: typeof msg === 'string' ? msg : JSON.stringify(msg) };
      }
    },

    resetPasswordWithOtp: async (email: string, otp: string, newPassword: string) => {
      const cleanEmail = email.trim();
      const cleanOtp = otp.trim();
      const cleanPass = newPassword.trim();
      if (!cleanPass || cleanPass.length < 6) {
        return { success: false, message: 'New password must be at least 6 characters.' };
      }
      try {
        const response = await api.post('/api/auth/reset-password', { email: cleanEmail, otp: cleanOtp, newPassword: cleanPass });
        return { success: true, message: response.data.message || 'Password reset successfully!' };
      } catch (err: any) {
        const msg = err.response?.data?.message || err.response?.data || 'Password reset failed. Please try again.';
        return { success: false, message: typeof msg === 'string' ? msg : JSON.stringify(msg) };
      }
    }
  };
});
