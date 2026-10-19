import { getAvatarByName, resolveAvatar } from '../services/avatar';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  Plus,
  Search,
  Calendar,
  Users,
  Clock,
  Info,
  ArrowUpRight,
  Check,
  Eye,
  Pencil,
  LayoutGrid,
  List,
  UserCheck,
  UserPlus,
  ChevronDown,
  AlertCircle,
  Filter,
  Layers,
  MoreHorizontal,
  FolderGit2,
  Trash2,
  MessageSquare
} from 'lucide-react';
import api from '../services/api';
import { useUIStore } from '../store/useUIStore';
import { useAuthStore } from '../store/useAuthStore';
import { formatRoleName } from '../services/authRoles';
import { useScrollLock } from '../hooks/useScrollLock';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  estimatedTime: number;
  actualTime: number;
  dependencyId?: number;
  allocationPercent?: number;
  subtasksCount?: number;
  completedSubtasksCount?: number;
  commentsCount?: number;
  dependenciesCount?: number;
  assignee?: { id: number; name: string; profilePhoto?: string; email?: string };
  project?: { id: number; name: string; title?: string };
}

interface TeamMember {
  id: number;
  name: string;
  role: string;
  designation?: string;
  profilePhoto?: string;
}

function formatDisplayDate(dateStr?: string) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function Tasks() {
  const { selectedProjectId, setTaskModalOpen, showToast } = useUIStore();
  const { user } = useAuthStore();
  const isTeamLeader = user?.role === 'ROLE_ADMIN' || user?.role === 'ROLE_MANAGER';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const [activeProjectId, setActiveProjectId] = useState<number | null>(selectedProjectId);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL'); // 'ALL' | 'UNASSIGNED' | 'userId'
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false);
  const [groupByAssignee, setGroupByAssignee] = useState(false);

  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isGridView, setIsGridView] = useState(false);

  // Assignee Reassignment Popover state
  const [assigningTaskId, setAssigningTaskId] = useState<number | null>(null);

  // Lock background scroll when assigning task modal is open
  useScrollLock(assigningTaskId !== null);

  // Row actions menu state
  const [activeMenuTaskId, setActiveMenuTaskId] = useState<number | null>(null);

  // Close active row menu on outside click
  useEffect(() => {
    const handleCloseMenu = () => setActiveMenuTaskId(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  // Global shortcut to focus task search with Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.id !== 'tasks-search-input') {
          return;
        }
        e.preventDefault();
        const searchInput = document.getElementById('tasks-search-input');
        if (searchInput) {
          searchInput.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    task: Task | null;
    type: 'accept' | 'decline' | null;
  }>({ isOpen: false, task: null, type: null });
  const [declineReason, setDeclineReasonText] = useState('');

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await api.get('/api/projects');
      setProjectsList(res.data || []);
      if (!activeProjectId && res.data && res.data.length > 0) {
        // Prefer project with id 11 or containing "Project Management" or first
        const pms = res.data.find((p: any) => p.name?.toLowerCase().includes('project management') || p.id === 11);
        if (selectedProjectId) {
          setActiveProjectId(selectedProjectId);
        } else if (pms) {
          setActiveProjectId(pms.id);
        } else {
          setActiveProjectId(res.data[0].id);
        }
      }
    } catch (err) {
      setProjectsList([]);
    }
  };

  const fetchTeamMembers = async () => {
    try {
      const res = await api.get('/api/teams');
      // System Administrator manages the portal only - filter out ROLE_ADMIN from assignment section
      const assignableMembers = (res.data || []).filter((m: any) => m.role !== 'ROLE_ADMIN' && !m.role?.includes('ADMIN'));
      setTeamMembers(assignableMembers);
    } catch (err) {
      setTeamMembers([]);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = activeProjectId 
        ? await api.get(`/api/tasks/project/${activeProjectId}`)
        : await api.get('/api/tasks');
      setTasks(res.data || []);
    } catch (err) {
      setTasks([]);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchTeamMembers();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [activeProjectId]);

  useEffect(() => {
    window.addEventListener('task-created', fetchTasks);
    window.addEventListener('task-status-updated', fetchTasks);
    return () => {
      window.removeEventListener('task-created', fetchTasks);
      window.removeEventListener('task-status-updated', fetchTasks);
    };
  }, [activeProjectId]);

  // Hook into global live auto-refresh
  useLiveRefresh(fetchTasks);

  const showToastMsg = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    showToast(msg, type);
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    if (newStatus === 'COMPLETED' && user?.role === 'ROLE_EMPLOYEE') {
      showToastMsg('🔒 Access Denied: Employees cannot mark tasks as COMPLETED. Please submit your task for REVIEW for Team Leader approval.', 'error');
      return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t));

    try {
      await api.put(`/api/tasks/${taskId}`, {
        ...task,
        status: newStatus
      });
      showToastMsg(`Task "${task.title}" status set to ${newStatus.replace('_', ' ')}`);
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const handlePriorityChange = async (taskId: number, newPriority: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setTasks(tasks.map(t => t.id === taskId ? { ...t, priority: newPriority } : t));

    try {
      await api.put(`/api/tasks/${taskId}`, {
        ...task,
        priority: newPriority
      });
      showToastMsg(`Priority for "${task.title}" updated to ${newPriority}`);
    } catch (err) {
      console.error('Failed to update priority', err);
    }
  };

  const handleReassignTask = async (taskId: number, newAssigneeId: number | null) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const selectedMember = teamMembers.find(m => m.id === newAssigneeId);
    const updatedAssignee = newAssigneeId && selectedMember ? {
      id: selectedMember.id,
      name: selectedMember.name,
      profilePhoto: selectedMember.profilePhoto
    } : undefined;

    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, assignee: updatedAssignee } : t));
    setAssigningTaskId(null);

    try {
      const taskRes = await api.get(`/api/tasks/${taskId}`);
      const taskData = taskRes.data;
      taskData.assignee = updatedAssignee ? { id: updatedAssignee.id } : null;
      await api.put(`/api/tasks/${taskId}`, taskData);
      showToastMsg(
        updatedAssignee
          ? `Task "${task.title}" assigned to ${updatedAssignee.name}!`
          : `Task "${task.title}" marked as unassigned.`,
        'success'
      );
    } catch (err) {
      console.error('Failed to reassign task', err);
      showToastMsg('Failed to reassign task.', 'error');
    }
  };

  const confirmAccept = async () => {
    if (!actionModal.task) return;
    const task = actionModal.task;
    try {
      const taskRes = await api.get(`/api/tasks/${task.id}`);
      const taskData = taskRes.data;
      taskData.status = 'TO_DO';
      await api.put(`/api/tasks/${task.id}`, taskData);
      showToastMsg(`Task "${task.title}" accepted successfully!`, 'success');
      setActionModal({ isOpen: false, task: null, type: null });
      fetchTasks();
    } catch (err) {
      showToastMsg('Failed to accept task assignment.', 'error');
    }
  };

  const confirmDecline = async () => {
    if (!actionModal.task || !declineReason.trim()) return;
    const task = actionModal.task;
    const reason = declineReason.trim();
    try {
      const commentPayload = {
        content: `🚨 [System Log] Task Declined. Reason: ${reason}`
      };
      await api.post(`/api/tasks/${task.id}/comments`, commentPayload);

      const taskRes = await api.get(`/api/tasks/${task.id}`);
      const taskData = taskRes.data;
      taskData.status = 'BACKLOG';
      taskData.assignee = null;
      taskData.declineReason = reason;
      await api.put(`/api/tasks/${task.id}`, taskData);
      
      showToastMsg(`Declined assignment for "${task.title}". Reason logged.`, 'info');
      setActionModal({ isOpen: false, task: null, type: null });
      setDeclineReasonText('');
      fetchTasks();
    } catch (err) {
      showToastMsg('Failed to submit decline response.', 'error');
    }
  };

  const openTaskEdit = (task: Task, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveMenuTaskId(null);
    setTaskModalOpen(true, task.status, true, task);
  };

  const openTaskDoubt = (task: Task, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveMenuTaskId(null);
    window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { ...task, focusComments: true } }));
  };

  const openTaskDetail = (task: Task, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveMenuTaskId(null);
    window.dispatchEvent(new CustomEvent('open-task-detail', { detail: task }));
  };

  const handleDeleteTask = async (taskId: number, taskTitle: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveMenuTaskId(null);
    if (!window.confirm(`Are you sure you want to permanently delete task "${taskTitle}"?`)) return;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      showToastMsg(`Task "${taskTitle}" deleted successfully.`, 'success');
      fetchTasks();
    } catch (err) {
      showToastMsg('Failed to delete task.', 'error');
    }
  };

  // Filter tasks based on Search Query, Status, Assignee, and Role permissions
  const filteredTasks = tasks.filter(t => {
    const titleVal = t.title || '';
    const matchesSearch = titleVal.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL'
      || t.status === statusFilter
      || (statusFilter === 'TO_DO' && (t.status === 'TO_DO' || t.status === 'ACCEPTED'));
    
    // Assignee filter logic
    let matchesAssigneeFilter = true;
    if (assigneeFilter === 'UNASSIGNED') {
      matchesAssigneeFilter = !t.assignee;
    } else if (assigneeFilter !== 'ALL') {
      const selectedMember = teamMembers.find(m => String(m.id) === assigneeFilter);
      matchesAssigneeFilter = Boolean(
        t.assignee?.id === parseInt(assigneeFilter) ||
        String(t.assignee?.id) === assigneeFilter ||
        (selectedMember && t.assignee?.name?.toLowerCase() === selectedMember.name?.toLowerCase())
      );
    }

    const userCleanName = user?.name?.trim().toLowerCase();
    const userCleanEmail = user?.email?.trim().toLowerCase();
    const isAssignedToUser = Boolean(
      t.assignee &&
        (t.assignee.id === user?.id ||
          (userCleanEmail && t.assignee.email && t.assignee.email.trim().toLowerCase() === userCleanEmail) ||
          (userCleanName && t.assignee.name && t.assignee.name.trim().toLowerCase() === userCleanName))
    );

    const matchesRoleAssignee = user?.role === 'ROLE_EMPLOYEE'
      ? isAssignedToUser
      : Boolean(!showMyTasksOnly || isAssignedToUser);

    return Boolean(matchesSearch && matchesStatus && matchesAssigneeFilter && matchesRoleAssignee);
  });

  const renderStatusBadge = (status: string) => {
    const norm = status.toUpperCase().replace(/\s+/g, '_');
    if (norm === 'IN_PROGRESS') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
          IN PROGRESS
        </span>
      );
    }
    if (norm === 'COMPLETED') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
          COMPLETED
        </span>
      );
    }
    if (norm === 'TO_DO' || norm === 'ACCEPTED') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-blue-500/15 text-blue-400 border border-blue-500/30">
          TO DO
        </span>
      );
    }
    if (norm === 'TESTING') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
          TESTING
        </span>
      );
    }
    if (norm === 'REVIEW') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-purple-500/15 text-purple-300 border border-purple-500/30">
          REVIEW
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-slate-500/15 text-slate-400 border border-slate-500/20">
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  const toDoCount = tasks.filter(t => t.status === 'TO_DO' || t.status === 'ACCEPTED' || t.status === 'TODO').length;
  const inProgressCount = tasks.filter(t => t.status === 'IN_PROGRESS').length;
  const reviewCount = tasks.filter(t => t.status === 'REVIEW').length;
  const completedCount = tasks.filter(t => t.status === 'COMPLETED').length;
  const backlogCount = tasks.filter(t => t.status === 'BACKLOG').length;

  return (
    <div className="space-y-4 sm:space-y-5 pb-20 lg:pb-12 w-full min-w-0">
      {/* ==================== OPTION 1: OBSIDIAN CYBER-GLASS & FLOATING COMMAND HUB ==================== */}
      <div className="bg-white/95 dark:bg-[#0a0f1d]/90 backdrop-blur-2xl border border-slate-200/90 dark:border-blue-500/20 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7),0_0_25px_-5px_rgba(59,130,246,0.12)]">
        
        {/* Tier 1: Title & Actions Hero Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                Workspace Tasks
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                {inProgressCount} In Progress
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium mt-1">
              Manage, prioritize, and track deliverables across active workspace sprints
            </p>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap self-start sm:self-auto">
            {/* Group Assignee Button for Team Leads */}
            {isTeamLeader && (
              <button
                onClick={() => setGroupByAssignee(!groupByAssignee)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all border ${
                  groupByAssignee
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20 font-bold'
                    : 'bg-slate-100 dark:bg-slate-900/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
                title="Group Tasks by Assignee"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Group Assignee</span>
              </button>
            )}

            {/* My Tasks Only Toggle */}
            {user?.role !== 'ROLE_EMPLOYEE' && (
              <div
                onClick={() => setShowMyTasksOnly(!showMyTasksOnly)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none hover:border-blue-500/30 transition-all"
              >
                <span>My Tasks Only</span>
                <div
                  className={`w-9 h-5 rounded-full transition-colors duration-200 relative p-0.5 inline-flex items-center ${
                    showMyTasksOnly ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                      showMyTasksOnly ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Add Task Button for Team Leads / Admins */}
            {isTeamLeader && (
              <button
                onClick={() => setTaskModalOpen(true)}
                className="px-4 py-2 rounded-xl text-white text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/30 hover:scale-[1.02] active:scale-95 transition-all"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Add Task</span>
              </button>
            )}
          </div>
        </div>

        {/* Tier 2: Unified Command Bar & Floating Filter Dock */}
        <div className="bg-slate-100/90 dark:bg-[#070b14]/90 border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-2.5 sm:p-3 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 shadow-inner">
          
          {/* Left: Search Input with ⌘K / Ctrl+K badge */}
          <div className="relative w-full xl:w-80 shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              id="tasks-search-input"
              type="text"
              placeholder="Search tasks by title, tag, or assignee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-12 py-2 bg-white dark:bg-[#090d18] border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500/80 transition-all font-medium"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-slate-500 dark:text-slate-400 pointer-events-none hidden sm:inline-block">
              ⌘K
            </span>
          </div>

          {/* Middle: Project Selector Pill + Live Status Chips */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar custom-scrollbar py-0.5 max-w-full">
            
            {/* Project Selector Pill Dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#090d18] border border-slate-200 dark:border-slate-800 hover:border-blue-500/40 text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 whitespace-nowrap shadow-xs transition-all cursor-pointer"
              >
                <div className="w-4 h-4 rounded-md bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-[10px] text-blue-400 font-bold shrink-0">
                  <FolderGit2 className="w-2.5 h-2.5 text-blue-400" />
                </div>
                <span className="truncate max-w-[150px]">
                  {projectsList.find(p => p.id === activeProjectId)?.name || 'All Projects'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {isProjectDropdownOpen && (
                <div className="absolute left-0 mt-2 w-64 bg-white/95 dark:bg-[#0b0f19]/95 border border-slate-200 dark:border-blue-500/30 rounded-xl shadow-2xl z-50 py-1.5 backdrop-blur-2xl">
                  <button
                    onClick={() => {
                      setActiveProjectId(null);
                      setIsProjectDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-xs font-semibold flex items-center gap-2 cursor-pointer ${
                      activeProjectId === null
                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-l-2 border-blue-500 font-bold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <FolderGit2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>All Projects ({projectsList.length})</span>
                  </button>
                  {projectsList.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setActiveProjectId(p.id);
                        setIsProjectDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-xs font-semibold flex items-center gap-2 cursor-pointer ${
                        activeProjectId === p.id
                          ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-l-2 border-blue-500 font-bold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <FolderGit2 className="w-3.5 h-3.5 text-blue-400" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Live Status Chips */}
            <div className="flex items-center gap-1.5 shrink-0">
              {[
                { id: 'ALL', label: `All (${tasks.length})` },
                ...(backlogCount > 0 ? [{ id: 'BACKLOG', label: `Backlog (${backlogCount})` }] : []),
                { id: 'TO_DO', label: `To Do (${toDoCount})` },
                { id: 'IN_PROGRESS', label: `In Progress (${inProgressCount})` },
                { id: 'REVIEW', label: `Review (${reviewCount})` },
                { id: 'COMPLETED', label: `Completed (${completedCount})` }
              ].map(tab => {
                const isActive = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border ${
                      isActive
                        ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.25)] font-extrabold'
                        : 'bg-white dark:bg-[#090d18] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800/80 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Segmented View Switcher */}
          <div className="flex items-center gap-1 bg-white dark:bg-[#090d18] p-1 rounded-xl border border-slate-200 dark:border-slate-800 shrink-0 self-end xl:self-auto">
            <button
              onClick={() => { setIsGridView(false); setGroupByAssignee(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                !isGridView && !groupByAssignee
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="List View"
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
            <button
              onClick={() => { setIsGridView(true); setGroupByAssignee(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                isGridView && !groupByAssignee
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Grid</span>
            </button>
          </div>

        </div>

      </div>

      {/* TEAM LEADER ASSIGNEE TRACKER */}
      {isTeamLeader && (
        <div className="bg-white/90 dark:bg-[#0e131f]/80 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-4 px-5 shadow-xs dark:shadow-lg space-y-3">
          <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase">
            TEAM LEAD ASSIGNEE TRACKER
          </div>

          {/* Team Member Filter Chips */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setAssigneeFilter('ALL')}
              className={`px-5 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                assigneeFilter === 'ALL'
                  ? 'bg-white dark:bg-[#1c2438] text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700/80 shadow-xs'
                  : 'bg-slate-50 dark:bg-[#111624] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800/80 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              All Members
            </button>

            <button
              onClick={() => setAssigneeFilter(assigneeFilter === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED')}
              className={`px-5 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${
                assigneeFilter === 'UNASSIGNED'
                  ? 'bg-amber-50 dark:bg-[#1c2438] text-amber-800 dark:text-white border border-amber-300 dark:border-amber-500/50 shadow-xs'
                  : 'bg-slate-50 dark:bg-[#111624] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              Unassigned
            </button>

            {teamMembers.map((member) => {
              const memberTaskCount = tasks.filter(t => 
                t.assignee?.id === member.id || 
                String(t.assignee?.id) === String(member.id) ||
                (t.assignee?.name && member.name && t.assignee.name.toLowerCase() === member.name.toLowerCase())
              ).length;
              const isSelected = assigneeFilter === String(member.id);
              return (
                <button
                  key={member.id}
                  onClick={() => setAssigneeFilter(isSelected ? 'ALL' : String(member.id))}
                  className={`flex items-center gap-3 px-3.5 py-1.5 rounded-full border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-[#1c2438] border-blue-400 dark:border-blue-500/60 shadow-xs'
                      : 'bg-slate-50 dark:bg-[#111624] border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-[#141b2c]'
                  }`}
                >
                  <img
                    src={resolveAvatar(member.profilePhoto, member.name, (member as any).gender)}
                    alt={member.name}
                    className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700/80 shrink-0"
                  />
                  <div className="text-left">
                    <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 leading-tight">
                      <span>{member.name}</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight mt-0.5">
                      {memberTaskCount} tasks
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Task Listing (Grouped by Assignee OR Grid OR Option 2 Table) */}
      {groupByAssignee ? (
        /* ================= GROUP BY ASSIGNEE WORKLOAD VIEW ================= */
        <div className="space-y-6">
          {/* Unassigned Workload Group */}
          <div className="glass-panel p-5 border border-amber-500/30 rounded-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-amber-500/20">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center font-black">
                  ⚠️
                </div>
                <div>
                  <h3 className="text-sm font-black text-amber-600 dark:text-amber-400">
                    Unassigned Tasks ({tasks.filter(t => !t.assignee).length})
                  </h3>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Tasks pending Team Leader assignment to a specific team member.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tasks.filter(t => !t.assignee).map(task => (
                <div
                  key={task.id}
                  className="p-4 bg-white/70 dark:bg-slate-900/70 border border-amber-500/20 rounded-2xl space-y-3 shadow-xs hover:border-amber-500/40 transition-all"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      {task.priority} Priority
                    </span>
                    <span className="text-[9px] font-bold text-slate-400">Due: {formatDisplayDate(task.dueDate)}</span>
                  </div>

                  <div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white line-clamp-1">{task.title}</h4>
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{task.description}</p>
                  </div>

                  {/* Reassign Button */}
                  <div className="pt-2 border-t border-slate-200/50 dark:border-white/5 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-500 truncate max-w-[120px]">
                      📁 {task.project?.name || 'General'}
                    </span>
                    <button
                      onClick={() => setAssigningTaskId(task.id)}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-[10px] flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <UserPlus className="w-3 h-3" /> Assign Teammate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Grouped by Team Member */}
          {teamMembers.map(member => {
            const memberTasks = filteredTasks.filter(t => 
              t.assignee?.id === member.id || 
              String(t.assignee?.id) === String(member.id) ||
              (t.assignee?.name && member.name && t.assignee.name.toLowerCase() === member.name.toLowerCase())
            );
            if (memberTasks.length === 0 && assigneeFilter !== 'ALL') return null;

            return (
              <div key={member.id} className="glass-panel p-5 border border-slate-200/50 dark:border-white/5 rounded-2xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/50 dark:border-white/5">
                  <div className="flex items-center gap-3">
                    <img
                      src={resolveAvatar(member.profilePhoto, member.name, (member as any).gender)}
                      alt="avatar"
                      className="w-9 h-9 rounded-xl object-cover ring-2 ring-blue-500/30"
                    />
                    <div>
                      <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                        {member.name}
                        <span className="text-[10px] font-extrabold px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-md uppercase">
                          {member.designation || formatRoleName(member.role, 'title')}
                        </span>
                      </h3>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {memberTasks.length} Active Task{memberTasks.length !== 1 ? 's' : ''} Assigned
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {memberTasks.map(task => (
                    <div
                      key={task.id}
                      onClick={() => openTaskDetail(task)}
                      className="p-4 bg-white/60 dark:bg-slate-900/60 border border-slate-200/60 dark:border-white/5 rounded-2xl space-y-3 shadow-xs hover:border-blue-500/30 cursor-pointer transition-all"
                    >
                      <div className="flex justify-between items-start">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
                          task.status === 'COMPLETED' ? 'bg-green-500/10 text-green-500' :
                          task.status === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-500' :
                          'bg-slate-500/10 text-slate-400'
                        }`}>
                          {task.status.replace('_', ' ')}
                        </span>
                        <span className="text-[9px] font-bold text-slate-400">Due: {formatDisplayDate(task.dueDate)}</span>
                      </div>

                      <div>
                        <h4 className="text-xs font-black text-slate-900 dark:text-white line-clamp-1">{task.title}</h4>
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{task.description}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-200/50 dark:border-white/5 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-blue-500 truncate max-w-[120px]">
                          📁 {task.project?.name || 'General'}
                        </span>
                        {isTeamLeader && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAssigningTaskId(task.id);
                            }}
                            className="px-2 py-1 bg-slate-200/60 dark:bg-white/10 hover:bg-blue-500/20 text-slate-700 dark:text-slate-300 hover:text-blue-500 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                          >
                            Re-assign
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : isGridView ? (
        /* ================= GRID VIEW ================= */
        filteredTasks.length === 0 ? (
          <div className="glass-panel p-16 text-center text-slate-400 text-xs font-bold flex flex-col items-center justify-center gap-3">
            <CheckSquare className="w-12 h-12 text-slate-300 dark:text-slate-700 animate-pulse" />
            No tasks found matching current filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTasks.map(task => (
              <div
                key={task.id}
                onClick={() => openTaskDetail(task)}
                className="glass-panel glass-panel-hover p-5 flex flex-col justify-between min-h-[220px] cursor-pointer relative"
              >
                <div className="space-y-3.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${
                      task.status === 'COMPLETED' ? 'bg-green-500/10 text-green-500' :
                      task.status === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-500' :
                      'bg-slate-500/10 text-slate-400'
                    }`}>
                      {task.status.replace('_', ' ')}
                    </span>

                    <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${
                      task.priority === 'CRITICAL' ? 'bg-red-500/10 text-red-500' :
                      task.priority === 'HIGH' ? 'bg-amber-500/10 text-amber-500' :
                      'bg-blue-500/10 text-blue-500'
                    }`}>
                      {task.priority} Priority
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-black text-slate-800 dark:text-white line-clamp-1">{task.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{task.description}</p>
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-slate-200/10 dark:border-white/5 space-y-3">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                    <span className="text-blue-500 flex items-center gap-1 font-black truncate max-w-[150px]">
                      📁 {task.project ? (task.project.name || task.project.title || 'General') : 'General'}
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Calendar className="w-3 h-3" /> {formatDisplayDate(task.dueDate)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    {task.assignee ? (
                      <div className="flex items-center gap-1.5">
                        <img
                          src={resolveAvatar(task.assignee.profilePhoto, task.assignee.name, (task.assignee as any).gender)}
                          alt="avatar"
                          className="w-5 h-5 rounded-full object-cover ring-1 ring-blue-500/10"
                        />
                        <span className="text-[10px] font-bold text-slate-300">{task.assignee.name}</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">Unassigned</span>
                    )}

                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 border border-slate-500/10">
                        ⏱️ {task.actualTime || 0}h/{task.estimatedTime || 0}h
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ================= OPTION 2 TABLE LIST VIEW ================= */
        <div className="bg-white dark:bg-[#0e131f]/70 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl shadow-xs dark:shadow-xl w-full">
          <div className="overflow-x-auto w-full custom-scrollbar min-h-[340px] pb-16">
            <table className="w-full text-left text-xs border-collapse min-w-[850px]">
              <thead>
                <tr className="border-b border-slate-200/90 dark:border-slate-800/80 bg-slate-50/90 dark:bg-slate-900/40 text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-24">ID</th>
                  <th className="py-3.5 px-4">Task Name</th>
                  <th className="py-3.5 px-4 w-44">Assignee</th>
                  <th className="py-3.5 px-4 w-28">Priority</th>
                  <th className="py-3.5 px-4 w-36">Status</th>
                  <th className="py-3.5 px-4 w-28">Due Date</th>
                  <th className="py-3.5 px-4 w-24 text-right pr-6">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center text-slate-400 font-medium">
                      No tasks found matching current filters.
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((task, taskIdx) => {
                    const initial = task.assignee ? task.assignee.name.charAt(0).toUpperCase() : '?';
                    const openUpwards = taskIdx >= Math.max(0, filteredTasks.length - 2);
                    return (
                      <tr
                        key={task.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-[#141b2c]/60 transition-colors group cursor-pointer"
                        onClick={() => openTaskDetail(task)}
                      >
                        <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 font-mono text-xs">
                          PM-{task.id}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-slate-900 dark:text-white font-bold text-xs sm:text-sm group-hover:text-blue-500 transition-colors">
                              {task.title}
                            </span>
                            {task.project?.name && (
                              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 truncate max-w-[220px]">
                                {task.project.name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className="py-3.5 px-4"
                          onClick={(e) => {
                            if (isTeamLeader) {
                              e.stopPropagation();
                              setAssigningTaskId(task.id);
                            }
                          }}
                        >
                          {task.assignee ? (
                            <div className="flex items-center -space-x-1.5" title={task.assignee.name}>
                              <div className="w-6 h-6 rounded-full bg-purple-600 text-white font-bold text-[10px] flex items-center justify-center ring-2 ring-white dark:ring-[#0e131f] shadow-xs shrink-0">
                                {initial}
                              </div>
                              <img
                                src={resolveAvatar(task.assignee.profilePhoto, task.assignee.name, (task.assignee as any).gender)}
                                alt={task.assignee.name}
                                className="w-6 h-6 rounded-full object-cover ring-2 ring-white dark:ring-[#0e131f] shadow-xs shrink-0"
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Unassigned</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {task.priority === 'HIGH' || task.priority === 'CRITICAL' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> High
                            </span>
                          ) : task.priority === 'LOW' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/30">
                              Low
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                              Medium
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {renderStatusBadge(task.status)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 font-medium text-xs whitespace-nowrap">
                          {formatDisplayDate(task.dueDate)}
                        </td>
                        <td className="py-3.5 px-4 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5 text-slate-400 relative">
                            {/* 1. Direct Edit Button */}
                            <button
                              onClick={(e) => openTaskEdit(task, e)}
                              className="p-1.5 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all cursor-pointer"
                              title="Edit Task Details"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {/* 2. Options / Doubt Dropdown Button */}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuTaskId(activeMenuTaskId === task.id ? null : task.id);
                                }}
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                  activeMenuTaskId === task.id
                                    ? 'text-blue-500 bg-blue-500/15'
                                    : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
                                }`}
                                title="More options & Doubt"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>

                              {/* Interactive Luxury Dropdown Menu */}
                              {activeMenuTaskId === task.id && (
                                <div
                                  className={`absolute right-0 ${openUpwards ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} w-52 bg-white dark:bg-[#0b0f19] backdrop-blur-2xl border border-slate-200 dark:border-blue-500/30 rounded-xl shadow-2xl z-[100] py-1.5 text-left divide-y divide-slate-100 dark:divide-slate-800/60 animate-in fade-in zoom-in-95 duration-100`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="py-1">
                                    <button
                                      onClick={(e) => openTaskEdit(task, e)}
                                      className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-600/15 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-2.5 transition-colors cursor-pointer"
                                    >
                                      <Pencil className="w-3.5 h-3.5 text-blue-500" />
                                      <span>Edit Task Details</span>
                                    </button>
                                    <button
                                      onClick={(e) => openTaskDoubt(task, e)}
                                      className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-600/15 hover:text-amber-600 dark:hover:text-amber-400 flex items-center gap-2.5 transition-colors cursor-pointer"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
                                      <span>Ask Doubt / Discuss</span>
                                    </button>
                                    <button
                                      onClick={(e) => openTaskDetail(task, e)}
                                      className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-purple-50 dark:hover:bg-purple-600/15 hover:text-purple-600 dark:hover:text-purple-400 flex items-center gap-2.5 transition-colors cursor-pointer"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-purple-500" />
                                      <span>View Steps & Evidence</span>
                                    </button>
                                  </div>

                                  {(isTeamLeader || user?.role === 'ROLE_ADMIN') && (
                                    <div className="py-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveMenuTaskId(null);
                                          setAssigningTaskId(task.id);
                                        }}
                                        className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 flex items-center gap-2.5 transition-colors cursor-pointer"
                                      >
                                        <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                                        <span>Reassign Teammate</span>
                                      </button>
                                      <button
                                        onClick={(e) => handleDeleteTask(task.id, task.title, e)}
                                        className="w-full px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 flex items-center gap-2.5 transition-colors cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                        <span>Delete Task</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Team Member Re-assignment Modal Popover */}
      {assigningTaskId !== null && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 touch-none overscroll-contain select-none">
          <div className="w-full max-w-sm max-h-[88vh] overflow-y-auto p-5 border rounded-3xl border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white space-y-4 modal-dialog-contain overscroll-contain">
            <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-500" />
                <h3 className="text-sm font-black tracking-tight">Assign Task to Teammate</h3>
              </div>
              <button
                onClick={() => setAssigningTaskId(null)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Select a team member to assign responsibility for this task.
            </p>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              <button
                onClick={() => handleReassignTask(assigningTaskId, null)}
                className="w-full flex items-center justify-between p-2.5 rounded-2xl border border-dashed border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-xs font-black transition-all cursor-pointer"
              >
                <span>⚠️ Mark as Unassigned</span>
              </button>

              {teamMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleReassignTask(assigningTaskId, member.id)}
                  className="w-full flex items-center justify-between p-2.5 rounded-2xl border border-slate-200/60 dark:border-white/10 hover:bg-blue-500/10 text-xs font-bold transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={resolveAvatar(member.profilePhoto, member.name, (member as any).gender)}
                      alt={member.name}
                      className="w-7 h-7 rounded-xl object-cover ring-1 ring-blue-500/20"
                    />
                    <div className="text-left">
                      <p className="font-black group-hover:text-blue-500 transition-colors">{member.name}</p>
                      <p className="text-[9.5px] text-slate-400 font-semibold">{member.designation || formatRoleName(member.role, 'title')}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-black px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-lg">
                    Assign →
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
