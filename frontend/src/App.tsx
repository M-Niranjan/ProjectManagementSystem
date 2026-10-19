import React, { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { useUIStore } from './store/useUIStore';
import { getDashboardPathForRole, normalizeRole } from './services/authRoles';
import { forceUnlockAllScroll } from './hooks/useScrollLock';

// Components & Modules
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import CommandPalette from './components/CommandPalette';
import VoiceController from './components/VoiceController';
import PomodoroTimer from './components/PomodoroTimer';
import TaskDetailModal from './components/TaskDetailModal';
import CreateProjectModal from './components/CreateProjectModal';
import CreateTaskModal from './components/CreateTaskModal';
import LuxuryToast from './components/common/LuxuryToast';
import SignOutConfirmModal from './components/common/SignOutConfirmModal';
import LiveRefreshProvider from './components/LiveRefreshProvider';
import GlobalCommunicationSyncProvider from './components/communication/GlobalCommunicationSyncProvider';
import IncomingCallPopup from './components/communication/IncomingCallPopup';
import ActiveVideoCallModal from './components/communication/ActiveVideoCallModal';
import { useCallStore } from './store/useCallStore';
import MobileBottomNav from './components/MobileBottomNav';

// Pages
import Login from './pages/Login';
import RegisterOrganization from './pages/RegisterOrganization';
import OrgSelector from './pages/OrgSelector';
import ResetPassword from './pages/ResetPassword';
import AcceptInvitation from './pages/AcceptInvitation';
import Dashboard, { AdminDashboard, TeamLeaderDashboard, EmployeeDashboard } from './pages/Dashboard';
import Projects from './pages/Projects';
import Boards from './pages/Boards';
import Calendar from './pages/Calendar';
import Timeline from './pages/Timeline';
import Teams from './pages/Teams';
import Messages from './pages/Messages';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Documents from './pages/Documents';
import Tasks from './pages/Tasks';
import TeamWorkTracking from './pages/TeamWorkTracking';
import StepVerificationDashboard from './pages/StepVerificationDashboard';
import EmployeeWorkProfilePage from './pages/EmployeeWorkProfilePage';
import WorkspaceActivity from './pages/WorkspaceActivity';

// Admin & Role Specific Views
import { UserManagementView, RolesPermissionsView, OrganizationSettingsView, AuditLogsView } from './pages/AdminViews';
import TaskReviews from './pages/TaskReviews';
import MyPerformance from './pages/MyPerformance';

const queryClient = new QueryClient();

const VIEW_TO_PATH: Record<string, string> = {
  dashboard: '/dashboard',
  'step-verification': '/step-verification',
  'team-tracking': '/team-tracking',
  'work-profile': '/team-tracking',
  projects: '/projects',
  'my-projects': '/my-projects',
  tasks: '/tasks',
  'my-tasks': '/my-tasks',
  boards: '/boards',
  calendar: '/calendar',
  timeline: '/timeline',
  'time-tracking': '/time-tracking',
  teams: '/teams',
  messages: '/messages',
  reports: '/reports',
  settings: '/settings',
  profile: '/profile',
  documents: '/documents',
  users: '/users',
  roles: '/roles',
  organization: '/organization',
  'audit-logs': '/audit-logs',
  reviews: '/reviews',
  performance: '/performance',
  'workspace-activity': '/workspace-activity',
};

const PATH_TO_VIEW: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/admin/dashboard': 'dashboard',
  '/admin-dashboard': 'dashboard',
  '/team-lead/dashboard': 'dashboard',
  '/team-leader-dashboard': 'dashboard',
  '/employee/dashboard': 'dashboard',
  '/employee-dashboard': 'dashboard',
  '/projects': 'projects',
  '/my-projects': 'my-projects',
  '/tasks': 'tasks',
  '/my-tasks': 'my-tasks',
  '/boards': 'boards',
  '/calendar': 'calendar',
  '/timeline': 'timeline',
  '/time-tracking': 'time-tracking',
  '/teams': 'teams',
  '/admin/teams': 'teams',
  '/messages': 'messages',
  '/reports': 'reports',
  '/settings': 'settings',
  '/admin/settings': 'settings',
  '/profile': 'profile',
  '/documents': 'documents',
  '/users': 'users',
  '/admin/users': 'users',
  '/roles': 'roles',
  '/admin/roles': 'roles',
  '/organization': 'organization',
  '/admin/organization': 'organization',
  '/audit-logs': 'audit-logs',
  '/admin/audit-logs': 'audit-logs',
  '/team-tracking': 'team-tracking',
  '/admin/team-tracking': 'team-tracking',
  '/team-lead/team-tracking': 'team-tracking',
  '/step-verification': 'step-verification',
  '/admin/step-verification': 'step-verification',
  '/team-lead/step-verification': 'step-verification',
  '/reviews': 'reviews',
  '/performance': 'performance',
  '/workspace-activity': 'workspace-activity',
};

function getViewFromPath(pathname: string) {
  if (pathname.includes('/work-profile')) return 'work-profile';
  if (pathname.includes('/team-lead/dashboard')) return 'dashboard';
  if (pathname.includes('/employee/dashboard')) return 'dashboard';
  if (pathname.includes('/admin/dashboard')) return 'dashboard';
  return PATH_TO_VIEW[pathname] ?? 'dashboard';
}

function getPathFromView(view: string, role?: string | null) {
  if (view === 'dashboard') {
    return getDashboardPathForRole(role);
  }
  return VIEW_TO_PATH[view] ?? getDashboardPathForRole(role);
}

function RoleDashboardRedirect() {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/" replace />;
  const path = getDashboardPathForRole(user.role);
  return path ? <Navigate to={path} replace /> : <Navigate to="/" replace />;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Uncaught UI Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto my-12 glass-panel border border-rose-500/30 rounded-3xl text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center font-bold text-xl">
            ⚠️
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">Workspace View Exception</h2>
          <p className="text-xs font-semibold text-slate-400">
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.hash = '#/dashboard';
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
          >
            Return to Work Tracking
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function RoleGuard({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactElement }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/" replace />;

  const normalizedUserRole = normalizeRole(user.role);
  const rawUserRole = String(user.role || '').trim();

  const isAllowed = allowedRoles.some(
    (role) => role === normalizedUserRole || role === rawUserRole || normalizeRole(role) === normalizedUserRole
  );

  if (!isAllowed) {
    const path = getDashboardPathForRole(user.role);
    return path ? <Navigate to={path} replace /> : <Navigate to="/" replace />;
  }
  return children;
}

function AppContent() {
  const { user, token, initAuth, loading, activeOrganizationId } = useAuthStore();
  const { activeView, initTheme, sidebarExpanded, setView, loginSplashActive, loginSplashExiting } = useUIStore();
  const location = useLocation();
  const navigate = useNavigate();
  const isNavigatingFromUI = useRef(false);
  const isInitialRouteSync = useRef(true);
  const lastActiveViewNav = useRef<string | null>(null);

  // Initialize theme mode and validate existing session JWT token on load
  useEffect(() => {
    initTheme();
    initAuth();
  }, []);

  // Universal WebRTC Incoming Call Listener across all modules
  const setupIncomingCallListener = useCallStore((s) => s.setupIncomingCallListener);
  useEffect(() => {
    if (user) {
      const currentUid = String((user as any).firebaseUid || user.uid || user.id);
      const altId = String(user.id);
      const cleanup = setupIncomingCallListener(currentUid, altId);
      return () => cleanup();
    }
  }, [user, setupIncomingCallListener]);

  // 1. Sync location.pathname -> activeView and scroll to top cleanly on route change
  useEffect(() => {
    forceUnlockAllScroll();
    window.scrollTo(0, 0);
    if (!token || !user) return;
    const matchedView = getViewFromPath(location.pathname);
    if (matchedView && matchedView !== activeView) {
      setView(matchedView);
    }
  }, [location.pathname]);

  // 2. Sync activeView -> location.pathname (when external components invoke setView directly)
  useEffect(() => {
    if (!token || !user) return;
    const expectedPath = getPathFromView(activeView, user.role);
    if (expectedPath && location.pathname !== expectedPath && getViewFromPath(location.pathname) !== activeView) {
      navigate(expectedPath);
    }
  }, [activeView]);

  const isSplashVisible = loginSplashActive;
  const isSplashExiting = loginSplashExiting;

  if (isSplashVisible) {
    return (
      <div className={`pms-login-splash${isSplashExiting ? ' pms-splash-exiting' : ''}`}>
        <div className="pms-splash-inner">
          {/* ── ICON: large, centered, on top ── */}
          <div className="pms-splash-icon-wrap">
            <img src="/logo.png" alt="PMS" className="pms-splash-icon" />
          </div>

          {/* ── TEXT: stacked center-aligned below icon ── */}
          <div className="pms-splash-text-block">
            <p className="pms-splash-line1">
              <span className="pms-splash-reveal pms-splash-delay-1">Project Management</span>
            </p>
            <p className="pms-splash-line2">
              <span className="pms-splash-reveal pms-splash-delay-2">System</span>
            </p>
          </div>

          {/* ── PROGRESS BAR ── */}
          <div className="pms-splash-bar-wrap">
            <div className="pms-splash-bar-track">
              <div className="pms-splash-bar-fill" />
            </div>
          </div>

          {/* ── CAPTION ── */}
          <p className="pms-splash-caption">LOADING WORKSPACE...</p>
        </div>
      </div>
    );
  }

  let mainContent: React.ReactNode = null;

  if (location.pathname === '/reset-password' || location.search.includes('oobCode')) {
    mainContent = <ResetPassword />;
  } else if (location.pathname === '/accept-invitation') {
    mainContent = <AcceptInvitation />;
  } else if (location.pathname === '/register-organization') {
    mainContent = <RegisterOrganization />;
  } else if (!token || !user) {
    mainContent = <Login />;
  } else if (!activeOrganizationId || location.pathname === '/select-organization') {
    mainContent = <OrgSelector />;
  } else {
    const isMessagesPage = location.pathname === '/messages';
    mainContent = (
      <div className={`relative ${isMessagesPage ? 'fixed inset-0 h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none' : 'min-h-screen overflow-x-hidden'}`}>
        {/* Pure Uniform Background Layer */}
        <div className="animated-bg" />

        {/* Core Shell Structure */}
        <div className="flex">
          {/* Sidebar */}
          <Sidebar />

          {/* Content Wrapper */}
          <div 
            className={`flex-1 flex flex-col ${isMessagesPage ? 'h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none' : 'min-h-screen overflow-x-hidden'} max-w-full transition-all duration-300 ease-in-out ${sidebarExpanded ? 'lg:pl-[286px]' : 'lg:pl-[88px]'} pl-0 print:p-0 print:m-0 print:pl-0`}
          >
            {/* Header Frosted Navbar */}
            <Navbar />

            {/* Mobile Bottom Navigation Dock */}
            <MobileBottomNav />

            <main className={`flex-1 min-w-0 max-w-full print:p-0 print:m-0 print:pt-0 print:max-w-none ${
              isMessagesPage
                ? 'w-full max-w-none flex flex-col h-[calc(100dvh-3.5rem)] max-h-[calc(100dvh-3.5rem)] mt-14 p-0 sm:p-2 overflow-hidden overscroll-none'
                : 'main-workspace-frame overflow-x-hidden px-3 sm:px-6 md:px-8 pb-24 sm:pb-20 lg:pb-12 w-full max-w-7xl mx-auto'
            }`}>
              <ErrorBoundary>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: isMessagesPage ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: isMessagesPage ? 0 : -6 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className={`w-full ${isMessagesPage ? 'h-full' : ''}`}
                  >
                    <Routes location={location}>
                      <Route path="/" element={<RoleDashboardRedirect />} />
                      <Route path="/dashboard" element={<RoleDashboardRedirect />} />
                      <Route path="/admin/dashboard" element={<RoleGuard allowedRoles={['ROLE_ADMIN', 'admin']}><AdminDashboard /></RoleGuard>} />
                      <Route path="/admin-dashboard" element={<RoleGuard allowedRoles={['ROLE_ADMIN', 'admin']}><Navigate to="/admin/dashboard" replace /></RoleGuard>} />
                      <Route path="/team-lead/dashboard" element={<RoleGuard allowedRoles={['ROLE_MANAGER', 'ROLE_TEAM_LEAD', 'teamLeader', 'team_leader', 'manager']}><TeamLeaderDashboard /></RoleGuard>} />
                      <Route path="/team-leader-dashboard" element={<RoleGuard allowedRoles={['ROLE_MANAGER', 'ROLE_TEAM_LEAD', 'teamLeader', 'team_leader', 'manager']}><Navigate to="/team-lead/dashboard" replace /></RoleGuard>} />
                      <Route path="/employee/dashboard" element={<RoleGuard allowedRoles={['ROLE_EMPLOYEE', 'employee']}><EmployeeDashboard /></RoleGuard>} />
                      <Route path="/employee-dashboard" element={<RoleGuard allowedRoles={['ROLE_EMPLOYEE', 'employee']}><Navigate to="/employee/dashboard" replace /></RoleGuard>} />
                      
                      {/* Common Modules */}
                      <Route path="/projects" element={<Projects />} />
                      <Route path="/my-projects" element={<Projects />} />
                      <Route path="/tasks" element={<Tasks />} />
                      <Route path="/my-tasks" element={<Tasks />} />
                      <Route path="/boards" element={<Boards />} />
                      <Route path="/calendar" element={<Calendar />} />
                      <Route path="/timeline" element={<Timeline />} />
                      <Route path="/time-tracking" element={<Timeline />} />
                      <Route path="/teams" element={<Teams />} />
                      <Route path="/messages" element={<Messages />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/workspace-activity" element={<WorkspaceActivity />} />

                      {/* User / Employee Directory (Available to all organization members) */}
                      <Route path="/users" element={<RoleGuard allowedRoles={['ROLE_ADMIN', 'ROLE_MANAGER', 'ROLE_TEAM_LEAD', 'ROLE_EMPLOYEE', 'admin', 'teamLeader', 'employee', 'manager']}><UserManagementView /></RoleGuard>} />
                      <Route path="/admin/users" element={<RoleGuard allowedRoles={['ROLE_ADMIN', 'ROLE_MANAGER', 'ROLE_TEAM_LEAD', 'ROLE_EMPLOYEE', 'admin', 'teamLeader', 'employee', 'manager']}><UserManagementView /></RoleGuard>} />
                      <Route path="/roles" element={<RoleGuard allowedRoles={['ROLE_ADMIN']}><RolesPermissionsView /></RoleGuard>} />
                      <Route path="/admin/roles" element={<RoleGuard allowedRoles={['ROLE_ADMIN']}><RolesPermissionsView /></RoleGuard>} />
                      <Route path="/organization" element={<RoleGuard allowedRoles={['ROLE_ADMIN']}><OrganizationSettingsView /></RoleGuard>} />
                      <Route path="/admin/organization" element={<RoleGuard allowedRoles={['ROLE_ADMIN']}><OrganizationSettingsView /></RoleGuard>} />
                      <Route path="/audit-logs" element={<RoleGuard allowedRoles={['ROLE_ADMIN', 'ROLE_MANAGER']}><AuditLogsView /></RoleGuard>} />
                      <Route path="/admin/audit-logs" element={<RoleGuard allowedRoles={['ROLE_ADMIN', 'ROLE_MANAGER']}><AuditLogsView /></RoleGuard>} />

                      {/* Role Specific Modules */}
                      <Route path="/team-tracking" element={<RoleGuard allowedRoles={['ROLE_MANAGER', 'ROLE_ADMIN']}><TeamWorkTracking /></RoleGuard>} />
                      <Route path="/employee/:id/work-profile" element={<RoleGuard allowedRoles={['ROLE_MANAGER', 'ROLE_ADMIN']}><EmployeeWorkProfilePage /></RoleGuard>} />
                      <Route path="/step-verification" element={<RoleGuard allowedRoles={['ROLE_MANAGER', 'ROLE_ADMIN', 'admin', 'teamLeader', 'team_leader', 'manager', 'ROLE_TEAM_LEAD']}><StepVerificationDashboard /></RoleGuard>} />
                      <Route path="/reviews" element={<RoleGuard allowedRoles={['ROLE_MANAGER', 'ROLE_ADMIN', 'admin', 'teamLeader', 'team_leader', 'manager', 'ROLE_TEAM_LEAD']}><TaskReviews /></RoleGuard>} />
                      <Route path="/performance" element={<RoleGuard allowedRoles={['ROLE_EMPLOYEE', 'employee', 'ROLE_MANAGER', 'ROLE_ADMIN', 'admin']}><MyPerformance /></RoleGuard>} />
                      <Route path="/select-organization" element={<OrgSelector />} />

                      <Route path="*" element={<RoleDashboardRedirect />} />
                    </Routes>
                  </motion.div>
                </AnimatePresence>
              </ErrorBoundary>
            </main>
          </div>
        </div>

        {/* Floating Utilities */}
        <CommandPalette />
        <VoiceController />
        <PomodoroTimer />
        <TaskDetailModal />
        <CreateProjectModal />
        <CreateTaskModal />
      </div>
    );
  }

  return (
    <>
      {mainContent}
      <IncomingCallPopup />
      <ActiveVideoCallModal />
      <LuxuryToast />
      <SignOutConfirmModal />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveRefreshProvider>
        <GlobalCommunicationSyncProvider>
          <AppContent />
        </GlobalCommunicationSyncProvider>
      </LiveRefreshProvider>
    </QueryClientProvider>
  );
}
