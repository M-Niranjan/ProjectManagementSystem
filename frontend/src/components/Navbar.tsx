import { getAvatarByName, resolveAvatar } from '../services/avatar';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { 
  Bell, 
  Search, 
  Mic, 
  Sun, 
  Moon, 
  Plus, 
  Globe, 
  Check, 
  Trash2, 
  ArrowRight, 
  Menu, 
  Building2, 
  ChevronDown, 
  User as UserIcon, 
  LogOut,
  CheckSquare,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  AtSign,
  Folder,
  FileText,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  CheckCheck,
  Circle,
  Eye,
  EyeOff
} from 'lucide-react';
import { useUIStore } from '../store/useUIStore';
import { useAuthStore } from '../store/useAuthStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { useCommunicationStore } from '../store/useCommunicationStore';
import { AppNotification } from '../services/notificationService';
import api from '../services/api';
import { requestMobilePushPermission } from '../services/mobilePushService';
import { useScrollLock } from '../hooks/useScrollLock';
import LiveRefreshControl from './LiveRefreshControl';

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 172800) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function isDateToday(dateStr: string): boolean {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    return (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  } catch {
    return false;
  }
}

export default function Navbar() {
  const navigate = useNavigate();
  const { 
    darkMode, 
    toggleTheme, 
    activeLanguage, 
    setLanguage, 
    activeView,
    setView, 
    setVoiceOverlay, 
    setPomodoroTimer,
    setProjectModalOpen,
    setTaskModalOpen,
    sidebarExpanded,
    toggleSidebar,
    showToast,
    setSignOutModalOpen
  } = useUIStore();
  const { user, activeOrganization, activeOrganizationId, orgMemberships, switchOrganization } = useAuthStore();

  const {
    notifications,
    unreadCount,
    isLoading: notificationsLoading,
    error: notificationsError,
    activeFilter: notifFilter,
    setActiveFilter: setNotifFilter,
    initRealtimeListener,
    stopRealtimeListener,
    fetchNotificationsFallback,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    deleteNotification,
  } = useNotificationStore();

  const { unreadCounts: chatUnreadCounts } = useCommunicationStore();
  const totalChatUnreads = Object.values(chatUnreadCounts || {}).reduce((sum, count) => sum + count, 0);
  const totalNavbarBadge = (unreadCount || 0) + (totalChatUnreads || 0);

  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const orgButtonRef = useRef<HTMLButtonElement>(null);

  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  const [showNotifications, setShowNotifications] = useState(false);
  const [showLanguages, setShowLanguages] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string | number>>(new Set());
  const [acceptedTaskIds] = useState<Set<number>>(() => {
    try {
      const stored = sessionStorage.getItem('acceptedTaskIds');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [declineModal, setDeclineModal] = useState<{
    isOpen: boolean;
    notification: AppNotification | null;
    task: any | null;
  }>({ isOpen: false, notification: null, task: null });
  const [declineReasonText, setDeclineReasonText] = useState('');

  // Lock background scroll when decline task modal is open
  useScrollLock(declineModal.isOpen);

  const languages = ['EN', 'ES', 'FR', 'DE', 'JA'];

  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const quickCreateRef = useRef<HTMLDivElement>(null);
  const quickCreateButtonRef = useRef<HTMLButtonElement>(null);
  const languagesRef = useRef<HTMLDivElement>(null);
  const languagesButtonRef = useRef<HTMLButtonElement>(null);

  // Initialize scoped Realtime Notification Listener
  useEffect(() => {
    if (user?.uid || user?.id) {
      const uid = user.uid || String(user.id);
      initRealtimeListener(uid, activeOrganizationId);
    }
    return () => {
      stopRealtimeListener();
    };
  }, [user?.uid, user?.id, activeOrganizationId, initRealtimeListener, stopRealtimeListener]);

  // Request & register Android / Web Push Permission once
  useEffect(() => {
    if (user?.uid || user?.id) {
      requestMobilePushPermission().catch(() => {});
    }
  }, [user?.uid, user?.id]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      
      if (showNotifications && 
          notificationsRef.current && !notificationsRef.current.contains(target) &&
          notificationButtonRef.current && !notificationButtonRef.current.contains(target)) {
        setShowNotifications(false);
      }

      if (showQuickCreate && 
          quickCreateRef.current && !quickCreateRef.current.contains(target) &&
          quickCreateButtonRef.current && !quickCreateButtonRef.current.contains(target)) {
        setShowQuickCreate(false);
      }

      if (showLanguages && 
          languagesRef.current && !languagesRef.current.contains(target) &&
          languagesButtonRef.current && !languagesButtonRef.current.contains(target)) {
        setShowLanguages(false);
      }

      if (showOrgDropdown && 
          orgDropdownRef.current && !orgDropdownRef.current.contains(target) &&
          orgButtonRef.current && !orgButtonRef.current.contains(target)) {
        setShowOrgDropdown(false);
      }

      if (showProfileDropdown && 
          profileDropdownRef.current && !profileDropdownRef.current.contains(target) &&
          profileButtonRef.current && !profileButtonRef.current.contains(target)) {
        setShowProfileDropdown(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications, showQuickCreate, showLanguages, showOrgDropdown, showProfileDropdown]);

  const handleNotificationItemClick = async (n: AppNotification) => {
    if (!n.isRead) {
      await markAsRead(n.id);
    }
    setShowNotifications(false);

    // Click Action Navigation
    if (n.entityType === 'task' || n.type.startsWith('TASK_')) {
      setView('tasks');
      navigate('/tasks');
    } else if (n.entityType === 'conversation' || n.type.includes('MESSAGE') || n.type.includes('CHAT')) {
      setView('communication');
      navigate('/messages');
    } else if (n.entityType === 'project' || n.type.startsWith('PROJECT_')) {
      setView('projects');
      navigate('/projects');
    } else if (n.entityType === 'document' || n.type.includes('STEP_') || n.type.includes('SUBMITTED')) {
      setView('step-verification');
      navigate('/step-verification');
    } else if (n.entityType === 'security' || n.type.includes('SECURITY')) {
      setView('settings');
      navigate('/settings');
    } else if (n.actionUrl) {
      navigate(n.actionUrl);
    }
  };

  const confirmDeclineFromNotification = async () => {
    const { notification, task } = declineModal;
    if (!notification || !task || !declineReasonText.trim()) return;

    try {
      setProcessingIds(prev => new Set(prev).add(notification.id));
      await api.put(`/api/tasks/${task.id}/status`, {
        status: 'DECLINED',
        declineReason: declineReasonText.trim(),
      });
      await markAsRead(notification.id);
      setDeclineModal({ isOpen: false, notification: null, task: null });
      setDeclineReasonText('');
      window.dispatchEvent(new Event('task-status-updated'));
      showToast('Task assignment declined.', 'info');
    } catch (err) {
      console.error('Failed to decline task', err);
      showToast('Failed to decline task assignment.', 'error');
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        if (notification) next.delete(notification.id);
        return next;
      });
    }
  };

  const handleNotificationAction = async (n: AppNotification, action: 'accept' | 'decline', e: React.MouseEvent) => {
    e.stopPropagation();
    if (processingIds.has(n.id)) return;

    if (action === 'accept') {
      try {
        setProcessingIds(prev => new Set(prev).add(n.id));
        const tasksRes = await api.get('/api/tasks');
        const allTasks: any[] = tasksRes.data || [];
        
        let matchingTask = null;
        if (n.entityId && !isNaN(Number(n.entityId))) {
          matchingTask = allTasks.find(t => t.id === Number(n.entityId));
        }
        if (!matchingTask) {
          const searchTitle = n.message
            .replace('You have been assigned: ', '')
            .replace('was assigned to you by', '')
            .trim()
            .replace(/^["']|["']$/g, '');

          matchingTask = allTasks.find(t => {
            const cleanTitle = t.title.trim().replace(/^["']|["']$/g, '').toLowerCase();
            return (cleanTitle === searchTitle.toLowerCase() || searchTitle.toLowerCase().includes(cleanTitle)) && t.status !== 'COMPLETED';
          });
        }

        if (matchingTask) {
          await api.put(`/api/tasks/${matchingTask.id}/status`, {
            status: 'ACCEPTED',
          });

          await markAsRead(n.id);

          const updated = new Set(acceptedTaskIds).add(matchingTask.id);
          sessionStorage.setItem('acceptedTaskIds', JSON.stringify([...updated]));
          window.dispatchEvent(new Event('task-status-updated'));
          showToast(`Accepted task: "${matchingTask.title}"`, 'success');
        } else {
          await markAsRead(n.id);
        }
      } catch (err) {
        console.error('Failed to accept task from notification', err);
        showToast('Failed to accept task.', 'error');
      } finally {
        setProcessingIds(prev => {
          const next = new Set(prev);
          next.delete(n.id);
          return next;
        });
      }
    } else {
      try {
        const tasksRes = await api.get('/api/tasks');
        const allTasks: any[] = tasksRes.data || [];
        let matchingTask = null;
        if (n.entityId && !isNaN(Number(n.entityId))) {
          matchingTask = allTasks.find(t => t.id === Number(n.entityId));
        }
        if (!matchingTask) {
          const searchTitle = n.message
            .replace('You have been assigned: ', '')
            .replace('was assigned to you by', '')
            .trim()
            .replace(/^["']|["']$/g, '');
          matchingTask = allTasks.find(t => {
            const cleanTitle = t.title.trim().replace(/^["']|["']$/g, '').toLowerCase();
            return (cleanTitle === searchTitle.toLowerCase() || searchTitle.toLowerCase().includes(cleanTitle)) && t.status !== 'COMPLETED';
          });
        }
        if (matchingTask) {
          setDeclineReasonText('');
          setDeclineModal({ isOpen: true, notification: n, task: matchingTask });
        } else {
          await markAsRead(n.id);
        }
      } catch (err) {
        console.error('Failed to load task for decline', err);
      }
    }
  };

  const triggerQuickAction = (actionType: 'project' | 'task') => {
    setShowQuickCreate(false);
    if (actionType === 'project') {
      setProjectModalOpen(true);
    } else {
      setTaskModalOpen(true);
    }
  };

  const triggerSearchPalette = () => {
    window.dispatchEvent(new Event('open-search-palette'));
  };

  // Filtered notifications
  const displayedNotifications = notifFilter === 'unread' 
    ? notifications.filter(n => !n.isRead) 
    : notifications;

  const todayList = displayedNotifications.filter(n => isDateToday(n.createdAt));
  const olderList = displayedNotifications.filter(n => !isDateToday(n.createdAt));

  const renderNotificationIcon = (type: string, priority?: string) => {
    const t = (type || '').toUpperCase();
    if (t.includes('ASSIGNED') || t.includes('TASK_NEW')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
          <CheckSquare className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('ACCEPTED') || t.includes('COMPLETED') || t.includes('APPROVED')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('DECLINED') || t.includes('REJECTED') || t.includes('CHANGES_REQUESTED') || priority === 'HIGH' || priority === 'URGENT') {
      return (
        <div className="w-7 h-7 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
          <AlertCircle className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('MESSAGE') || t.includes('CHAT')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
          <MessageSquare className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('MENTION')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
          <AtSign className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('PROJECT')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <Folder className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('SUBMITTED') || t.includes('PDF') || t.includes('DOCUMENT')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
          <FileText className="w-3.5 h-3.5" />
        </div>
      );
    }
    if (t.includes('SECURITY') || t.includes('LOGIN') || t.includes('PASSWORD')) {
      return (
        <div className="w-7 h-7 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-3.5 h-3.5" />
        </div>
      );
    }
    return (
      <div className="w-7 h-7 rounded-lg bg-slate-500/15 text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0">
        <Bell className="w-3.5 h-3.5" />
      </div>
    );
  };

  return (
    <header className={`fixed top-0 right-0 left-0 z-20 h-14 glass-navbar flex flex-nowrap items-center justify-between gap-2 sm:gap-4 px-2.5 sm:px-4 print:hidden ${sidebarExpanded ? 'lg:pl-[286px]' : 'lg:pl-[92px]'} pl-2.5 sm:pl-4 transition-all duration-200 ease-in-out`}>
      {/* Left: Navigation Drawer Trigger & Active Organization Switcher */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-shrink-0">
        <button
          onClick={toggleSidebar}
          className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100/90 dark:bg-white/[0.07] hover:bg-slate-200/80 dark:hover:bg-white/[0.12] text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-white/[0.09] active:scale-95 transition-all shadow-xs cursor-pointer flex-shrink-0"
          title="Toggle Navigation Menu"
          aria-label="Toggle Navigation Menu"
        >
          <Menu className="w-4.5 h-4.5 stroke-[2.2]" />
        </button>

        {/* Active Organization Badge & Switcher */}
        {activeOrganization && (
          <div className="relative flex-shrink-0 min-w-0">
            <button
              ref={orgButtonRef}
              onClick={() => setShowOrgDropdown(!showOrgDropdown)}
              className="h-9 px-2.5 sm:px-3 flex items-center gap-2 rounded-full bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/90 dark:border-white/[0.09] hover:border-indigo-500/40 dark:hover:border-indigo-400/40 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-all cursor-pointer shadow-xs max-w-[150px] xs:max-w-[200px] sm:max-w-[240px] lg:max-w-[340px]"
              title={`Organization: ${activeOrganization.organizationName} (Workspace: ${activeOrganization.organizationCode || activeOrganization.organizationId})`}
            >
              <div className="w-5.5 h-5.5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/25 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0 shadow-xs">
                <Building2 className="w-3.5 h-3.5 stroke-[2.2]" />
              </div>
              <span className="truncate text-xs font-semibold tracking-tight">{activeOrganization.organizationName}</span>
              {/* Subtle Live Sync Pulse Beacon */}
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 animate-pulse flex-shrink-0" title="Live Auto-Sync Active" />
              <span className="hidden lg:inline-flex items-center font-mono text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 flex-shrink-0">
                Workspace: {activeOrganization.organizationCode || activeOrganization.organizationId}
              </span>
              {orgMemberships && orgMemberships.length > 1 && (
                <ChevronDown className={`w-3 h-3 text-slate-400 flex-shrink-0 transition-transform ${showOrgDropdown ? 'rotate-180 text-indigo-500' : ''}`} />
              )}
            </button>

            {showOrgDropdown && (
              <div
                ref={orgDropdownRef}
                className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-2.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/80 mb-1.5">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Current Workspace</p>
                  <p className="text-xs font-bold text-slate-900 dark:text-white truncate mt-0.5">{activeOrganization.organizationName}</p>
                  <p className="text-[11px] font-mono text-blue-600 dark:text-blue-400 mt-0.5">Workspace: {activeOrganization.organizationCode || activeOrganization.organizationId}</p>
                </div>

                <div className="px-3 py-1">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Switch Workspace</p>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1">
                  {orgMemberships.map((org) => {
                    const isActive = org.organizationId === activeOrganizationId;
                    return (
                      <button
                        key={org.organizationId}
                        onClick={async () => {
                          setShowOrgDropdown(false);
                          if (!isActive) {
                            await switchOrganization(org.organizationId);
                          }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                          isActive
                            ? 'bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-300 font-bold'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-bold truncate">{org.organizationName}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[9px] uppercase px-1 py-0.2 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                              {org.organizationCode || org.organizationId}
                            </span>
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider">{org.role}</span>
                          </div>
                        </div>
                        {isActive && <Check className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/80">
                  <button
                    onClick={() => {
                      setShowOrgDropdown(false);
                      useAuthStore.setState({ activeOrganizationId: null });
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span>All Workspaces</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center 1: Tablet Search & Voice Trigger Icons */}
      <div className="hidden sm:flex lg:hidden items-center gap-1.5 flex-shrink-0">
        <button
          onClick={triggerSearchPalette}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.09] hover:bg-slate-200/70 dark:hover:bg-white/[0.12] text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 active:scale-95 transition-all cursor-pointer flex-shrink-0 shadow-xs"
          title="Search Workspace (3SK)"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setVoiceOverlay(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.09] hover:bg-slate-200/70 dark:hover:bg-white/[0.12] text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 active:scale-95 transition-all cursor-pointer flex-shrink-0 shadow-xs"
          title="Voice command palette"
        >
          <Mic className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Center 2: Desktop Search Bar */}
      <div className="hidden lg:flex items-center gap-2 flex-1 max-w-sm xl:max-w-md min-w-0 mx-3">
        <div 
          onClick={triggerSearchPalette}
          className="w-full h-9 items-center justify-between gap-2 px-3.5 bg-slate-100/80 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 rounded-full text-slate-600 dark:text-slate-400 text-xs cursor-pointer transition-all select-none shadow-xs flex"
        >
          <div className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="truncate text-xs text-slate-600 dark:text-slate-400 font-normal">Search workspace...</span>
          </div>
          <kbd className="hidden xl:inline-block px-2 py-0.5 text-[10px] bg-slate-200/80 dark:bg-white/10 text-slate-600 dark:text-slate-300 rounded-full font-mono border border-slate-300/60 dark:border-white/10">
            3SK
          </kbd>
        </div>

        <button
          onClick={() => setVoiceOverlay(true)}
          className="w-9 h-9 items-center justify-center rounded-full bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.09] hover:bg-slate-200/70 dark:hover:bg-white/[0.12] text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 active:scale-95 transition-all cursor-pointer flex-shrink-0 flex shadow-xs"
          title="Voice command palette"
        >
          <Mic className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Navbar Items */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        {user?.role !== 'ROLE_EMPLOYEE' && (
          <div className="hidden sm:block relative flex-shrink-0">
            <button
              ref={quickCreateButtonRef}
              onClick={() => setShowQuickCreate(!showQuickCreate)}
              className="h-9 px-3.5 flex items-center justify-center gap-1.5 bg-teal-500/15 hover:bg-teal-500/25 text-teal-700 dark:text-teal-300 border border-teal-500/30 dark:border-teal-500/40 hover:border-teal-400 rounded-full font-semibold text-xs shadow-xs active:scale-95 transition-all cursor-pointer flex-shrink-0"
              title="Create new project or task"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Create</span>
            </button>
            
            {showQuickCreate && (
              <div 
                ref={quickCreateRef}
                className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg py-1 shadow-lg z-50"
              >
                <button
                  onClick={() => triggerQuickAction('project')}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer flex items-center gap-2"
                >
                  Create Project
                </button>
                <button
                  onClick={() => triggerQuickAction('task')}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer flex items-center gap-2"
                >
                  Create Task
                </button>
                <div className="border-t border-zinc-200 dark:border-zinc-800 my-1"></div>
                <button
                  onClick={() => setPomodoroTimer(true)}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer flex items-center gap-2"
                >
                  Focus Timer
                </button>
              </div>
            )}
          </div>
        )}

        {/* Live Refresh Control */}
        <div className="hidden sm:flex">
          <LiveRefreshControl />
        </div>

        {/* Apple iOS Theme Toggle (Visible on Mobile & Desktop) */}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100/90 dark:bg-white/[0.07] border border-slate-200/80 dark:border-white/[0.09] hover:bg-slate-200/70 dark:hover:bg-white/[0.12] text-slate-700 dark:text-slate-200 active:scale-95 transition-all shadow-xs cursor-pointer flex-shrink-0"
          title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label="Toggle Theme"
        >
          {darkMode ? (
            <Sun className="w-4.5 h-4.5 text-amber-400 animate-in spin-in-180 duration-200" />
          ) : (
            <Moon className="w-4.5 h-4.5 text-indigo-600 animate-in spin-in-180 duration-200" />
          )}
        </button>

        {/* Language Toggle */}
        <div className="hidden xl:block relative flex-shrink-0">
          <button
            ref={languagesButtonRef}
            onClick={() => setShowLanguages(!showLanguages)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.09] hover:bg-slate-200/70 dark:hover:bg-white/[0.12] text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer font-medium text-xs flex-shrink-0 shadow-xs"
            title="Language"
          >
            <Globe className="w-4 h-4" />
          </button>
          {showLanguages && (
            <div 
              ref={languagesRef}
              className="absolute right-0 mt-2 w-28 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg py-1 shadow-lg z-50"
            >
              {languages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setLanguage(lang);
                    setShowLanguages(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer flex items-center justify-between"
                >
                  {lang}
                  {activeLanguage === lang && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Production Notification Center Bell & Dropdown */}
        <div className="relative flex-shrink-0">
          <button
            ref={notificationButtonRef}
            onClick={() => setShowNotifications(!showNotifications)}
            className={`relative w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer flex-shrink-0 shadow-xs ${
              showNotifications
                ? 'bg-blue-500/20 border border-blue-500/50 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20'
                : 'bg-slate-100/90 dark:bg-white/[0.07] border border-slate-200/80 dark:border-white/[0.09] hover:bg-slate-200/70 dark:hover:bg-white/[0.12] text-slate-700 dark:text-slate-200'
            }`}
            title="Notifications Center"
          >
            <Bell className="w-4 h-4" />
            {totalNavbarBadge > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-gradient-to-r from-rose-500 to-red-600 text-white rounded-full text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#07080c] shadow-xs animate-in fade-in zoom-in-75">
                {totalNavbarBadge > 99 ? '99+' : totalNavbarBadge}
              </span>
            )}
          </button>
          
          {showNotifications && (
            <div 
              ref={notificationsRef}
              className="fixed sm:absolute top-14 sm:top-full left-2 right-2 sm:left-auto sm:right-0 mt-1.5 sm:mt-2 w-auto sm:w-[380px] max-w-[420px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 overflow-hidden rounded-2xl animate-in fade-in zoom-in-95 duration-150"
            >
              {/* Header */}
              <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900/90 border-b border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-full">
                      {unreadCount} unread
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={async () => {
                      const granted = await requestMobilePushPermission();
                      if (granted) {
                        showToast("Push notifications activated for this device!", "success");
                      } else {
                        showToast("Notification permission requested.", "info");
                      }
                    }}
                    className="text-[10px] font-semibold px-2 py-0.8 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-md cursor-pointer transition-colors"
                    title="Enable push alerts on mobile & desktop"
                  >
                    Enable Push
                  </button>

                  {unreadCount > 0 && (
                    <button 
                      onClick={markAllAsRead}
                      className="text-[10px] font-semibold px-2 py-0.8 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md cursor-pointer transition-colors flex items-center gap-1"
                      title="Mark all notifications as read"
                    >
                      <CheckCheck className="w-3 h-3" />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-950/40 gap-1.5">
                <button
                  onClick={() => setNotifFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    notifFilter === 'all'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  All ({notifications.length})
                </button>
                <button
                  onClick={() => setNotifFilter('unread')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    notifFilter === 'unread'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Unread ({unreadCount})
                </button>
              </div>

              {/* Notification List Panel */}
              <div className="max-h-[380px] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {notificationsLoading ? (
                  <div className="p-8 text-center space-y-2">
                    <RefreshCw className="w-5 h-5 text-blue-500 animate-spin mx-auto" />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Loading notifications...</p>
                  </div>
                ) : notificationsError ? (
                  <div className="p-6 text-center space-y-2">
                    <AlertCircle className="w-6 h-6 text-rose-500 mx-auto" />
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 font-semibold">{notificationsError}</p>
                    <button
                      onClick={() => fetchNotificationsFallback()}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                ) : displayedNotifications.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">You're all caught up!</p>
                    <p className="text-[11px] text-zinc-400">No new notifications at this time.</p>
                  </div>
                ) : (
                  <>
                    {/* TODAY SECTION */}
                    {todayList.length > 0 && (
                      <div>
                        <div className="px-3.5 py-1.5 bg-zinc-100/60 dark:bg-zinc-950/60 sticky top-0 z-10">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Today</p>
                        </div>
                        {todayList.map((n) => renderNotificationCard(n))}
                      </div>
                    )}

                    {/* OLDER SECTION */}
                    {olderList.length > 0 && (
                      <div>
                        <div className="px-3.5 py-1.5 bg-zinc-100/60 dark:bg-zinc-950/60 sticky top-0 z-10">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Older</p>
                        </div>
                        {olderList.map((n) => renderNotificationCard(n))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {user && (
          <div className="relative flex items-center gap-1.5 sm:gap-2 pl-0.5 sm:pl-1 flex-shrink-0">
            <div className="h-5 w-px bg-slate-200 dark:bg-white/[0.08] flex-shrink-0" />
            <button
              ref={profileButtonRef}
              onClick={() => {
                setShowProfileDropdown(false);
                navigate('/profile');
                setView('profile');
              }}
              className={`w-9 h-9 flex items-center justify-center rounded-full cursor-pointer transition-all flex-shrink-0 relative ${
                activeView === 'profile'
                  ? 'ring-2 ring-indigo-500 bg-indigo-500/10'
                  : 'hover:opacity-90 active:scale-95'
              }`}
              title="My Profile (About)"
              aria-label="My Profile (About)"
            >
              <img
                src={resolveAvatar(user.profilePhoto, user.name, user.gender)}
                alt="Avatar"
                className="w-9 h-9 rounded-full object-cover ring-1.5 ring-slate-200/90 dark:ring-white/20 hover:scale-105 transition-transform shadow-xs"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#07080c]" />
            </button>

            {showProfileDropdown && (
              <div
                ref={profileDropdownRef}
                className="absolute right-0 top-11 w-72 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-2.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
              >
                {/* User Header */}
                <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/80 mb-2 flex items-center gap-2.5">
                  <img
                    src={resolveAvatar(user.profilePhoto, user.name, user.gender)}
                    alt="Avatar"
                    className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200 dark:ring-white/10"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                  </div>
                </div>

                {/* Current Workspace Section */}
                {activeOrganization && (
                  <div className="px-3 py-2 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-slate-100 dark:border-white/5 mb-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Current Workspace</p>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate mt-0.5 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      {activeOrganization.organizationName}
                    </p>
                    <p className="text-[10px] font-mono text-blue-600 dark:text-blue-400 mt-0.5">
                      Workspace: {activeOrganization.organizationCode || activeOrganization.organizationId}
                    </p>
                  </div>
                )}

                {/* Switch Workspace Section */}
                {orgMemberships && orgMemberships.length > 1 && (
                  <div className="mb-2">
                    <p className="px-3 text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Switch Workspace</p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {orgMemberships.map((org) => {
                        const isActive = org.organizationId === activeOrganizationId;
                        return (
                          <button
                            key={org.organizationId}
                            onClick={async () => {
                              setShowProfileDropdown(false);
                              if (!isActive) {
                                await switchOrganization(org.organizationId);
                              }
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                              isActive
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300 font-bold'
                                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            <span className="truncate">{org.organizationName}</span>
                            <span className="font-mono text-[9px] uppercase px-1 py-0.2 rounded bg-slate-200 dark:bg-white/10 text-slate-500 shrink-0">
                              {org.organizationCode || org.organizationId}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Links */}
                <div className="pt-1.5 border-t border-zinc-100 dark:border-zinc-800/80 space-y-1">
                  <button
                    onClick={() => {
                      setShowProfileDropdown(false);
                      setView('profile');
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                    <span>My Profile</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowProfileDropdown(false);
                      setSignOutModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-500" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {declineModal.isOpen && declineModal.task && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 touch-none overscroll-contain select-none">
          <div className="w-full max-w-md max-h-[88vh] overflow-y-auto p-5 space-y-4 border rounded-xl border-zinc-200 dark:border-zinc-800 shadow-xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 modal-dialog-contain overscroll-contain">
            <div className="space-y-1">
              <h2 className="text-sm font-bold flex items-center gap-2">
                Decline Task Assignment
              </h2>
              <p className="text-xs text-zinc-500">
                Task: <strong className="text-zinc-800 dark:text-zinc-200">"{declineModal.task.title}"</strong>
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500">
                  Decline Reason:
                </label>
                <textarea
                  rows={3}
                  value={declineReasonText}
                  onChange={(e) => setDeclineReasonText(e.target.value)}
                  placeholder="Provide details of why you cannot accept this task assignment..."
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-100 text-xs resize-none"
                />
              </div>
              
              <div className="flex justify-between items-center pt-1">
                <button
                  onClick={() => setDeclineModal({ isOpen: false, notification: null, task: null })}
                  className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  disabled={!declineReasonText.trim()}
                  onClick={confirmDeclineFromNotification}
                  className={`px-3 py-1.5 text-white rounded-lg text-xs font-medium ${
                    declineReasonText.trim()
                      ? 'bg-rose-600 hover:bg-rose-500 cursor-pointer'
                      : 'bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  Decline Task
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );

  function renderNotificationCard(n: AppNotification) {
    const isUnread = !n.isRead;
    return (
      <div 
        key={n.id} 
        onClick={() => handleNotificationItemClick(n)}
        className={`p-3 transition-colors cursor-pointer flex items-start gap-3 group relative ${
          isUnread 
            ? 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/35' 
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
        }`}
      >
        {/* Unread Status Pill */}
        {isUnread && (
          <span className="absolute left-1 top-4 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
        )}

        {/* Icon */}
        {renderNotificationIcon(n.type, n.priority)}

        {/* Content */}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between gap-1">
            <p className={`text-xs truncate ${isUnread ? 'font-bold text-zinc-900 dark:text-white' : 'font-medium text-zinc-700 dark:text-zinc-300'}`}>
              {n.title}
            </p>
            <span className="text-[10px] text-zinc-400 shrink-0 font-medium">
              {formatRelativeTime(n.createdAt)}
            </span>
          </div>

          <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-2 leading-relaxed">
            {n.message}
          </p>

          {n.senderName && (
            <p className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
              <span>from {n.senderName}</span>
            </p>
          )}

          {/* Quick Actions for Task Assigned */}
          {n.type === 'TASK_ASSIGNED' && (
            <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => handleNotificationAction(n, 'accept', e)}
                disabled={processingIds.has(n.id)}
                className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-xs transition-colors"
              >
                Accept
              </button>
              <button
                onClick={(e) => handleNotificationAction(n, 'decline', e)}
                disabled={processingIds.has(n.id)}
                className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer shadow-xs transition-colors"
              >
                Decline
              </button>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => isUnread ? markAsRead(n.id) : markAsUnread(n.id)}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors"
            title={isUnread ? 'Mark as read' : 'Mark as unread'}
          >
            {isUnread ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => deleteNotification(n.id)}
            className="p-1 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            title="Delete notification"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }
}
