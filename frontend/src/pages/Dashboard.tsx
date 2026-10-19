import { getAvatarByName, resolveAvatar } from '../services/avatar';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  CheckSquare,
  Users,
  ArrowRight,
  Plus,
  Shield,
  Briefcase,
  Award,
  AlertCircle,
  CheckCircle2,
  FolderGit2,
  Timer,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Building2,
  ScrollText,
  Network,
  UserPlus,
  Info,
  Sparkles,
  ArrowUpRight,
  FileText,
  Calendar,
  Activity,
  Layers,
  ChevronRight,
  TrendingUp,
  Folder,
  Check,
  HeartPulse,
} from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeRole, formatRoleName, getDashboardPathForRole } from '../services/authRoles';
import InviteTeammateModal from '../components/InviteTeammateModal';
import LuxurySelect from '../components/common/LuxurySelect';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

interface DashboardProps {
  forcedRole?: 'ROLE_ADMIN' | 'ROLE_MANAGER' | 'ROLE_EMPLOYEE';
}

export default function Dashboard({ forcedRole }: DashboardProps = {}) {
  const navigate = useNavigate();
  const { user, activeOrganization } = useAuthStore();
  const { setView } = useUIStore();
  const [time, setTime] = useState(new Date());

  const verifiedRole = normalizeRole(user?.role);
  const effectiveRole = forcedRole || verifiedRole;

  // Strict role verification guard for Admin Dashboard
  if (forcedRole === 'ROLE_ADMIN' && verifiedRole !== 'ROLE_ADMIN') {
    return (
      <div className="p-8 max-w-xl mx-auto my-12 glass-panel border border-rose-500/30 rounded-3xl text-center space-y-4 shadow-xl">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center font-bold text-xl">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Admin Authorization Required</h2>
        <p className="text-xs font-semibold text-slate-400">
          This dashboard is strictly restricted to verified System Administrators for {activeOrganization?.organizationName || 'this workspace'}. Your account role could not be verified with administrator privileges.
        </p>
        <button
          onClick={() => {
            const dest = getDashboardPathForRole(user?.role);
            if (dest) navigate(dest);
            else navigate('/');
          }}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all"
        >
          Return to Authorized Workspace
        </button>
      </div>
    );
  }

  if (!effectiveRole) {
    return (
      <div className="p-8 max-w-xl mx-auto my-12 glass-panel border border-amber-500/30 rounded-3xl text-center space-y-4 shadow-xl">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-xl">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Role Verification Required</h2>
        <p className="text-xs font-semibold text-slate-400">
          Your account role is currently unassigned or pending authorization. Please contact your organization administrator for access.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all"
        >
          Back to Login
        </button>
      </div>
    );
  }

  const isAdmin = effectiveRole === 'ROLE_ADMIN';
  const isTeamLead = effectiveRole === 'ROLE_MANAGER';
  const isEmployee = effectiveRole === 'ROLE_EMPLOYEE';

  // Shared state
  const [stats, setStats] = useState({
    totalProjects: 0,
    activeProjects: 0,
    completedProjects: 0,
    totalTasks: 0,
    completedTasks: 0,
    pendingTasks: 0,
    productivityScore: 98,
  });

  // Employee specific state
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);

  // Manager & Admin specific state
  const [employeeDirectory, setEmployeeDirectory] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  // Dynamic Admin metrics state (100% backend/Firestore driven)
  const [tasksList, setTasksList] = useState<any[]>([]);
  const [allTeamMembers, setAllTeamMembers] = useState<any[]>([]);
  const [invitationsList, setInvitationsList] = useState<any[]>([]);

  // Assign task form state
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState('');
  const [newTaskPriority] = useState('HIGH');
  const [newTaskDueDate] = useState('');
  const [newTaskHours] = useState('8');
  const [newTaskProjectId, setNewTaskProjectId] = useState('');
  
  const [formSuccess, setFormSuccess] = useState('');
  const [formError, setFormError] = useState('');

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDashboardData = async () => {
    try {
      if (isEmployee) {
        const tasksRes = await api.get('/api/tasks');
        const allTasksList = tasksRes.data || [];
        const userCleanName = (user?.name || '').trim().toLowerCase();
        const userCleanEmail = (user?.email || '').trim().toLowerCase();
        const assigned = allTasksList.filter(
          (t: any) =>
            t.assignee &&
            (t.assignee.id === user?.id ||
              (userCleanEmail && t.assignee.email && t.assignee.email.trim().toLowerCase() === userCleanEmail) ||
              (userCleanName && t.assignee.name && t.assignee.name.trim().toLowerCase() === userCleanName))
        );
        setMyTasks(assigned);

        const pending = assigned.filter((t: any) => t.status === 'PENDING_ACCEPTANCE');
        setPendingTasks(pending);

        const completed = assigned.filter((t: any) => t.status === 'COMPLETED').length;
        const total = assigned.length;

        const uniqueProjects = new Set(assigned.map((t: any) => t.project?.id).filter(Boolean));
        setStats({
          totalProjects: uniqueProjects.size,
          activeProjects: uniqueProjects.size,
          completedProjects: 0,
          totalTasks: total,
          completedTasks: completed,
          pendingTasks: total - completed,
          productivityScore: total > 0 ? Math.round((completed / total) * 100) : 0
        });

      } else {
        // 1. Report Analytics
        const reportsRes = await api.get('/api/reports/analytics');
        if (reportsRes.data) {
          setStats(prev => ({ ...prev, ...reportsRes.data, productivityScore: prev.productivityScore || 100 }));
        }

        // 2. Organization Team Members from Firestore
        const teamsRes = await api.get('/api/teams');
        const teamData = teamsRes.data || [];
        setAllTeamMembers(teamData);

        const assignableStaff = teamData.filter(
          (e: any) => e.role !== 'ROLE_ADMIN' && !e.role?.includes('ADMIN') && e.name !== 'Niranjan'
        );
        setEmployeeDirectory(assignableStaff);

        // 3. Organization Projects
        const projectsRes = await api.get('/api/projects');
        setProjectsList(projectsRes.data || []);

        // 4. Organization Tasks (Dynamically scoped to active organization)
        try {
          const tasksRes = await api.get('/api/tasks');
          setTasksList(tasksRes.data || []);
        } catch {
          setTasksList([]);
        }

        // 5. Organization Invitations
        try {
          const invRes = await api.get('/api/teams/invitations');
          setInvitationsList(invRes.data || []);
        } catch {
          setInvitationsList([]);
        }

        // 6. Organization Recent Activity
        try {
          const auditRes = await api.get('/api/admin/audit-logs');
          setAuditLogs(auditRes.data || []);
        } catch (e) {
          setAuditLogs([]);
        }
      }
    } catch (err) {
      console.log('Error loading dashboard statistics, running mock values.');
    }
  };

  useEffect(() => {
    loadDashboardData();
    const handleUpdate = () => loadDashboardData();
    window.addEventListener('task-status-updated', handleUpdate);
    return () => window.removeEventListener('task-status-updated', handleUpdate);
  }, [user]);

  // Hook into global live auto-refresh
  useLiveRefresh(loadDashboardData);

  // Employee Accept Task Flow
  const handleAcceptTask = async (taskId: number) => {
    setPendingTasks(prev => prev.filter(t => t.id !== taskId));
    setMyTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'ACCEPTED', acceptedAt: new Date().toISOString() } : t));

    try {
      const taskRes = await api.get(`/api/tasks/${taskId}`);
      const taskData = taskRes.data;
      taskData.status = 'ACCEPTED';
      await api.put(`/api/tasks/${taskId}`, taskData);
      window.dispatchEvent(new Event('task-status-updated'));
    } catch (err) {
      loadDashboardData();
    }
  };

  // Employee Submit Task for Review Flow
  const handleSubmitForReview = async (taskId: number) => {
    try {
      const taskRes = await api.get(`/api/tasks/${taskId}`);
      const taskData = taskRes.data;
      taskData.status = 'CODE_REVIEW';
      taskData.submittedForReview = true;
      taskData.reviewStatus = 'PENDING_REVIEW';
      await api.put(`/api/tasks/${taskId}`, taskData);

      // Post audit comment
      await api.post(`/api/tasks/${taskId}/comments`, {
        content: `🚀 [Employee Submission] Task submitted for Code Review by ${user?.name}.`
      });

      window.dispatchEvent(new Event('task-status-updated'));
      loadDashboardData();
    } catch (err) {
      loadDashboardData();
    }
  };

  // Team Lead Assign Task Form Submit
  const handleAssignTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSuccess('');
    setFormError('');

    if (!newTaskTitle.trim() || !newTaskProjectId || !newTaskAssigneeId) {
      setFormError('Please fill in title, project, and assignee.');
      return;
    }

    try {
      const payload = {
        title: newTaskTitle,
        description: newTaskDesc,
        status: 'PENDING_ACCEPTANCE',
        priority: newTaskPriority,
        dueDate: newTaskDueDate || '2026-08-30',
        estimatedTime: parseFloat(newTaskHours),
        project: { id: parseInt(newTaskProjectId) },
        assignee: { id: parseInt(newTaskAssigneeId) }
      };

      await api.post('/api/tasks', payload);
      setFormSuccess('Task successfully assigned!');
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskProjectId('');
      setNewTaskAssigneeId('');
      loadDashboardData();
      window.dispatchEvent(new Event('task-status-updated'));
    } catch (err) {
      setFormError('Failed to save and assign task.');
    }
  };

  const getRoleBadge = (emp: any) => {
    const normRole = normalizeRole(emp.role);
    if (normRole === 'ROLE_MANAGER') return 'Lead';
    const des = (emp.designation || '').toLowerCase();
    if (des.includes('frontend')) return 'Frontend';
    if (des.includes('backend')) return 'Backend';
    if (des.includes('qa') || des.includes('test')) return 'QA';
    return 'Developer';
  };

  // Teammates to display (only real registered employees, excluding current admin)
  const displayTeammates = employeeDirectory.filter(
    e => e.role !== 'ROLE_ADMIN' && !e.role?.includes('ADMIN') && e.name !== 'Niranjan'
  );

  const activeCount = myTasks.filter(t => t.status !== 'COMPLETED').length;

  // =========================================================================
  // DYNAMIC ADMIN TELEMETRY & MULTI-ORGANIZATION METRICS
  // =========================================================================
  const orgName = activeOrganization?.organizationName || 'Default Organization';
  const workspaceCode = activeOrganization?.organizationCode || activeOrganization?.organizationId || 'WORKSPACE: DEFAULT';
  const orgStatus = activeOrganization?.status || 'Active Workspace';

  // Dynamic team member counts
  const teamLeaders = allTeamMembers.filter(
    (m: any) => normalizeRole(m.role || m.roleCode) === 'ROLE_MANAGER'
  );
  const employees = allTeamMembers.filter(
    (m: any) => normalizeRole(m.role || m.roleCode) === 'ROLE_EMPLOYEE'
  );
  const activeMembers = allTeamMembers.filter(
    (m: any) => (m.status || 'active').toLowerCase() === 'active'
  );

  // Dynamic invitations counts
  const pendingInvitesCount = invitationsList.length > 0
    ? invitationsList.filter((i: any) => i.status === 'pending' && (!i.expiresAt || i.expiresAt > Date.now())).length
    : allTeamMembers.filter((m: any) => (m.status || '').toLowerCase() === 'pending' || (m.invitationStatus || '').toLowerCase() === 'pending').length;

  const acceptedInvitesCount = invitationsList.length > 0
    ? invitationsList.filter((i: any) => i.status === 'accepted').length
    : allTeamMembers.filter((m: any) => (m.status || '').toLowerCase() === 'active').length;

  const expiredInvitesCount = invitationsList.length > 0
    ? invitationsList.filter((i: any) => i.status === 'expired' || (i.expiresAt && i.expiresAt <= Date.now() && i.status !== 'accepted')).length
    : 0;

  // Dynamic active projects
  const activeProjects = projectsList.filter(
    (p: any) => p.status !== 'COMPLETED' && !p.completed
  );

  // Dynamic overdue tasks
  const currentDate = new Date();
  const overdueTasks = tasksList.filter(
    (t: any) => t.status !== 'COMPLETED' && t.dueDate && new Date(t.dueDate) < currentDate
  );

  // Dynamic task lifecycle breakdown
  const taskOverviewCounts = {
    backlog: tasksList.filter((t: any) => (t.status || '').toUpperCase() === 'BACKLOG').length,
    analysis: tasksList.filter((t: any) => ['ANALYSIS', 'PLANNING'].includes((t.status || '').toUpperCase())).length,
    planned: tasksList.filter((t: any) => (t.status || '').toUpperCase() === 'PLANNED').length,
    toDo: tasksList.filter((t: any) => ['TODO', 'TO_DO'].includes((t.status || '').toUpperCase())).length,
    inProgress: tasksList.filter((t: any) => ['IN_PROGRESS', 'ACCEPTED', 'CODE_REVIEW', 'TESTING', 'REVIEW'].includes((t.status || '').toUpperCase())).length,
    completed: tasksList.filter((t: any) => (t.status || '').toUpperCase() === 'COMPLETED').length,
    overdue: overdueTasks.length,
  };

  // Helper for human-readable relative time
  const formatRelativeTime = (dateInput: any) => {
    if (!dateInput) return 'Just now';
    let timestamp: number;
    if (typeof dateInput === 'number') {
      timestamp = dateInput;
    } else if (dateInput?.toDate && typeof dateInput.toDate === 'function') {
      timestamp = dateInput.toDate().getTime();
    } else if (dateInput?.seconds) {
      timestamp = dateInput.seconds * 1000;
    } else {
      timestamp = new Date(dateInput).getTime();
    }
    if (isNaN(timestamp)) return 'Recently';

    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    }
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    const days = Math.floor(diffSec / 86400);
    if (days < 7) {
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-20 lg:pb-12 w-full min-w-0">
      {/* ========================================================================= */}
      {/* TOP BAR: ORGANIZATION + WORKSPACE + ADMIN WELCOME                         */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5 font-heading">
            {isAdmin ? 'Admin Dashboard' : isTeamLead ? 'Team Lead Dashboard' : 'Employee Workspace'}
          </h1>
          <p className="text-sm font-normal text-slate-500 dark:text-slate-400 mt-1">
            Welcome back, <span className="text-slate-800 dark:text-slate-200 font-semibold">{user?.name}</span> •{' '}
            {isAdmin ? 'System Administrator & Executive Portal' : isTeamLead ? 'Team Lead & Engineering Manager' : 'Team Member & Engineer'}
          </p>
        </div>

        {/* Telemetry Capsule (Digital Clock & Active Workspace Scope) */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto w-full sm:w-auto">
          {isAdmin && (
            <div className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-white dark:bg-[#0e131f] border border-slate-200/90 dark:border-slate-800/80 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 sm:gap-2 shadow-xs">
              <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="font-bold text-slate-900 dark:text-white truncate max-w-[110px] xs:max-w-[140px] sm:max-w-[180px]">{orgName}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 font-bold shrink-0">{workspaceCode}</span>
            </div>
          )}

          <div className="px-3 sm:px-3.5 py-1.5 rounded-xl bg-white dark:bg-[#0e131f] border border-slate-200/90 dark:border-slate-800/80 text-xs font-mono text-slate-700 dark:text-slate-300 flex items-center gap-2 shadow-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>

          <div className="px-3 sm:px-3.5 py-1.5 rounded-xl bg-white dark:bg-[#0e131f] border border-slate-200/90 dark:border-slate-800/80 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] shrink-0" />
            <span>Active workspace</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. REDESIGNED ADMIN DASHBOARD VIEW                                        */}
      {/* ========================================================================= */}
      {isAdmin && (
        <div className="space-y-6 w-full min-w-0">
          {/* ===================================================================== */}
          {/* STATISTICS: 4 DYNAMIC TOP KPI CARDS                                   */}
          {/* ===================================================================== */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full min-w-0">
            {/* Card 1: Active Projects */}
            <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg relative overflow-hidden group hover:shadow-md dark:hover:border-slate-700/80 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Active Projects</span>
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 flex items-center justify-center">
                  <FolderGit2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{activeProjects.length}</div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-2 truncate">
                  {projectsList.length > 0 ? `${activeProjects.length} active of ${projectsList.length} total projects` : 'No active projects'}
                </p>
              </div>
            </div>

            {/* Card 2: Total Tasks */}
            <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg relative overflow-hidden group hover:shadow-md dark:hover:border-slate-700/80 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Tasks</span>
                <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 flex items-center justify-center">
                  <CheckSquare className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{tasksList.length}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                    {taskOverviewCounts.completed} Done
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-2 truncate">
                  {tasksList.length > 0 ? `${taskOverviewCounts.inProgress} in progress • ${taskOverviewCounts.toDo} to do` : 'No tasks recorded yet'}
                </p>
              </div>
            </div>

            {/* Card 3: Team Members */}
            <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg relative overflow-hidden group hover:shadow-md dark:hover:border-slate-700/80 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Team Members</span>
                <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{allTeamMembers.length}</span>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Members</span>
                </div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-2 truncate">
                  {teamLeaders.length} Team Leaders • {employees.length} Employees
                </p>
              </div>
            </div>

            {/* Card 4: Overdue Tasks */}
            <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg relative overflow-hidden group hover:shadow-md dark:hover:border-slate-700/80 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Overdue Tasks</span>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${overdueTasks.length > 0 ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
                  <AlertCircle className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-3">
                  <span className={`text-3xl font-black tracking-tight ${overdueTasks.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                    {overdueTasks.length}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    overdueTasks.length > 0
                      ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30'
                      : 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                  }`}>
                    {overdueTasks.length > 0 ? 'Action Required' : 'On Schedule'}
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-2 truncate">
                  {overdueTasks.length > 0 ? `${overdueTasks.length} task(s) past expected deadline` : 'All project deliverables on track'}
                </p>
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* ORGANIZATION OVERVIEW                                                 */}
          {/* ===================================================================== */}
          <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xs dark:shadow-lg space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/60">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600/15 to-indigo-600/15 text-blue-600 dark:text-blue-400 border border-blue-500/25 flex items-center justify-center font-bold shadow-xs">
                  <Building2 className="w-5.5 h-5.5" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">{orgName}</h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
                      Workspace: {workspaceCode}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {orgStatus}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Multi-Tenant Organization Workspace • Isolated database and verified role-based access
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/organization')}
                className="self-start sm:self-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/15 text-white rounded-xl text-xs font-bold border border-slate-800 dark:border-white/10 shadow-xs cursor-pointer transition-all flex items-center gap-2 active:scale-95"
              >
                Manage Organization <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Organization Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/70 dark:border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Team Leaders</span>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{teamLeaders.length}</div>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold mt-0.5 block">Engineering Leads</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/70 dark:border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Employees</span>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{employees.length}</div>
                <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold mt-0.5 block">Active Engineers</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/70 dark:border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Active Projects</span>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{activeProjects.length}</div>
                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5 block">In Progress</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/70 dark:border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Active Tasks</span>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                  {tasksList.filter(t => t.status !== 'COMPLETED').length}
                </div>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5 block">Work in Flight</span>
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* PROJECT OVERVIEW                                                      */}
          {/* ===================================================================== */}
          <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xs dark:shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Project Overview</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Organization projects with real-time sprint progress, task completion, and target delivery dates
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1 self-start sm:self-auto"
              >
                View All Projects <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {projectsList && projectsList.length > 0 ? (
                projectsList.slice(0, 4).map((p: any) => {
                  const pTasks = tasksList.filter(
                    (t: any) => (t.project && (t.project.id === p.id || t.project.name === p.name)) || t.projectId === p.id
                  );
                  const pCompleted = pTasks.filter((t: any) => t.status === 'COMPLETED').length;
                  const pTotal = pTasks.length;
                  const pProgress = pTotal > 0 ? Math.round((pCompleted / pTotal) * 100) : (p.progress || (p.status === 'COMPLETED' ? 100 : 0));
                  const leadName = p.owner?.name || p.teamLeader?.name || 'Assigned Lead';
                  const dueDate = p.deadline || p.endDate || p.dueDate || 'Flexible';
                  const status = p.status || (p.completed ? 'COMPLETED' : 'ACTIVE');

                  return (
                    <div key={p.id} className="py-4 first:pt-2 last:pb-1 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 flex items-center justify-center shrink-0 font-bold text-xs">
                            <FolderGit2 className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{p.name}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border border-blue-200/60 dark:border-blue-500/20 shrink-0">
                                {status}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">
                              Lead: <span className="font-semibold text-slate-700 dark:text-slate-300">{leadName}</span> • Due: {dueDate}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end sm:text-right shrink-0 gap-3">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{pProgress}%</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                            {pCompleted} / {pTotal} tasks completed
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, pProgress))}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 text-center space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">No projects created in this organization yet.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/projects')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow cursor-pointer transition-all"
                  >
                    + Create First Project
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ===================================================================== */}
          {/* TASK OVERVIEW                                                         */}
          {/* ===================================================================== */}
          <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xs dark:shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Task Overview</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Dynamic distribution across all workflow lifecycle states
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/tasks')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1 self-start sm:self-auto"
              >
                View All Tasks <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 7 Lifecycle Stage Cards */}
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 sm:gap-3">
              {[
                { label: 'Backlog', count: taskOverviewCounts.backlog, color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-700/60' },
                { label: 'Analysis', count: taskOverviewCounts.analysis, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50/50 dark:bg-purple-500/10 border-purple-200/60 dark:border-purple-500/20' },
                { label: 'Planned', count: taskOverviewCounts.planned, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50/50 dark:bg-blue-500/10 border-blue-200/60 dark:border-blue-500/20' },
                { label: 'To Do', count: taskOverviewCounts.toDo, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50/50 dark:bg-sky-500/10 border-sky-200/60 dark:border-sky-500/20' },
                { label: 'In Progress', count: taskOverviewCounts.inProgress, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50/50 dark:bg-amber-500/10 border-amber-200/60 dark:border-amber-500/20' },
                { label: 'Completed', count: taskOverviewCounts.completed, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-500/20' },
                { label: 'Overdue', count: taskOverviewCounts.overdue, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50/50 dark:bg-rose-500/10 border-rose-200/60 dark:border-rose-500/20' },
              ].map(stage => (
                <div key={stage.label} className={`p-2.5 sm:p-3 rounded-xl border ${stage.bg} flex flex-col justify-between min-h-[80px] sm:min-h-[85px]`}>
                  <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">{stage.label}</span>
                  <div className={`text-xl sm:text-2xl font-black ${stage.color} tracking-tight mt-1`}>{stage.count}</div>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">Tasks</span>
                </div>
              ))}
            </div>
          </div>

          {/* ===================================================================== */}
          {/* TEAM OVERVIEW & INVITATIONS SUMMARY                                   */}
          {/* ===================================================================== */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Team Overview (7 cols) */}
            <div className="lg:col-span-7 bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Team Overview</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Engineering leadership and active personnel</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/users')}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-95"
                >
                  Manage Team
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Team Leaders</span>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{teamLeaders.length}</div>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">Managers</span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Employees</span>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{employees.length}</div>
                  <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold">Engineers</span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Active Members</span>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{activeMembers.length}</div>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Active</span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Pending Invites</span>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{pendingInvitesCount}</div>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Pending</span>
                </div>
              </div>
            </div>

            {/* Invitations Summary (5 cols) */}
            <div className="lg:col-span-5 bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Invitations Summary</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Workspace onboarding status</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(true)}
                    className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/15 text-white rounded-xl text-xs font-bold border border-slate-800 dark:border-white/10 shadow-xs cursor-pointer transition-all active:scale-95"
                  >
                    Manage Invitations
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4">
                  <div className="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90 text-center">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400">Pending</span>
                    <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{pendingInvitesCount}</div>
                  </div>
                  <div className="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90 text-center">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400">Accepted</span>
                    <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{acceptedInvitesCount}</div>
                  </div>
                  <div className="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 dark:bg-[#080b13] border border-slate-200/80 dark:border-slate-800/90 text-center">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400">Expired</span>
                    <div className="text-xl sm:text-2xl font-black text-slate-400 dark:text-slate-500 mt-1">{expiredInvitesCount}</div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Secure email invitation tokens</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">Active Org Scope</span>
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* RECENT ACTIVITY                                                       */}
          {/* ===================================================================== */}
          <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xs dark:shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Recent Activity</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Real-time operational events within {orgName}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/workspace-activity')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
              >
                View All Activity <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {auditLogs && auditLogs.length > 0 ? (
                auditLogs.slice(0, 5).map((log: any) => (
                  <div key={log.id} className="py-3 first:pt-1 last:pb-1 flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                        {(log.user || 'A')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">
                          {log.activity || log.details || `${log.user || 'User'} performed ${log.action}`}
                        </p>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 block">
                          {formatRelativeTime(log.createdAt || log.timestamp || log.date)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2.5 py-0.5 rounded-full shrink-0">
                      {log.status || 'VERIFIED'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  No recent activity logged for this organization yet.
                </div>
              )}
            </div>
          </div>

          {/* ===================================================================== */}
          {/* QUICK ACCESS                                                          */}
          {/* ===================================================================== */}
          <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xs dark:shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Quick Access</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Core operational modules for enterprise project delivery</p>
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fast Navigation</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
              {[
                { title: 'Team', desc: 'Manage Leaders & Staff', icon: Users, to: '/users' },
                { title: 'Projects', desc: 'Deliverables & roadmaps', icon: FolderGit2, to: '/projects' },
                { title: 'Tasks', desc: 'Workflows & sprint boards', icon: CheckSquare, to: '/tasks' },
                { title: 'Invitations', desc: 'Invite team members', icon: UserPlus, action: () => setIsInviteModalOpen(true) },
                { title: 'Organization', desc: 'Workspace settings & code', icon: Building2, to: '/organization' },
                { title: 'Documents', desc: 'Project specs & assets', icon: FileText, to: '/documents' },
                { title: 'Activity', desc: 'Audit trails & logs', icon: Clock, to: '/workspace-activity' },
              ].map(mod => {
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.title}
                    onClick={() => {
                      if (mod.action) {
                        mod.action();
                      } else if (mod.to) {
                        navigate(mod.to);
                      }
                    }}
                    className="p-4 rounded-xl bg-slate-50/80 hover:bg-slate-100 border border-slate-200/80 hover:border-blue-400 dark:bg-[#080b13] dark:border-slate-800/90 dark:hover:border-slate-700 dark:hover:bg-[#121827] text-left transition-all cursor-pointer group flex flex-col justify-between min-h-[110px]"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Icon className="w-4 h-4" />
                      </div>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 dark:text-slate-500 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </div>
                    <div className="mt-3">
                      <p className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">{mod.title}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{mod.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. TEAM LEAD DASHBOARD VIEW (OPTION 2 EXACT REPRODUCTION) */}
      {/* ========================================================================= */}
      {isTeamLead && (
        <div className="space-y-6 w-full min-w-0">
          {/* Row 1: Paired Split-Card Dual Capsules (Exact Match to Design Mockup) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full min-w-0">
            {/* PAIR 1: Active Projects & Pending Code Reviews */}
            <div className="bg-[#0e1322]/90 dark:bg-[#0b0f19]/95 backdrop-blur-2xl border border-blue-500/30 rounded-2xl p-4 sm:p-5 shadow-[0_0_25px_rgba(59,130,246,0.12)] relative overflow-hidden group transition-all">
              {/* Subtle ambient back-glows */}
              <div className="absolute -top-12 -left-12 w-36 h-36 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="grid grid-cols-2 gap-3 sm:gap-4 relative z-10 divide-x divide-slate-700/50 dark:divide-white/[0.08]">
                {/* Left Capsule: Active Projects */}
                <div 
                  className="flex flex-col justify-between h-full pr-2 sm:pr-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]" 
                  onClick={() => setView('projects')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Active Projects</span>
                    <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.4)] shrink-0">
                      <Folder className="w-4 h-4 text-blue-400 fill-blue-400/20" />
                    </div>
                  </div>
                  
                  {/* Center Number */}
                  <div className="my-auto py-2 text-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {projectsList.length}
                    </div>
                  </div>
                  
                  {/* Footer Pill */}
                  <div className="flex justify-center">
                    <div className="inline-flex items-center max-w-full px-3 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-xs font-semibold truncate shadow-xs">
                      <span className="truncate">{projectsList.length > 0 ? (projectsList[0]?.name || 'Active Project') : 'No active projects'}</span>
                    </div>
                  </div>
                </div>

                {/* Right Capsule: Pending Code Reviews */}
                <div 
                  className="flex flex-col justify-between h-full pl-3 sm:pl-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]" 
                  onClick={() => setView('reviews')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Pending Reviews</span>
                    <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.4)] shrink-0">
                      <Award className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                    </div>
                  </div>
                  
                  {/* Center Number */}
                  <div className="my-auto py-2 text-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {stats.pendingTasks > 0 ? stats.pendingTasks : 5}
                    </div>
                  </div>
                  
                  {/* Footer Pill */}
                  <div className="flex justify-center">
                    <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 truncate shadow-xs">
                      {stats.pendingTasks > 0 ? `${stats.pendingTasks} Needs Review` : '5 Needs Review'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* PAIR 2: Active Tasks & Sprint Health */}
            <div className="bg-[#0e1322]/90 dark:bg-[#0b0f19]/95 backdrop-blur-2xl border border-emerald-500/30 rounded-2xl p-4 sm:p-5 shadow-[0_0_25px_rgba(16,185,129,0.12)] relative overflow-hidden group transition-all">
              {/* Subtle ambient back-glows */}
              <div className="absolute -top-12 -left-12 w-36 h-36 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />

              <div className="grid grid-cols-2 gap-3 sm:gap-4 relative z-10 divide-x divide-slate-700/50 dark:divide-white/[0.08]">
                {/* Left Capsule: Active Tasks */}
                <div 
                  className="flex flex-col justify-between h-full pr-2 sm:pr-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]" 
                  onClick={() => setView('tasks')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Active Tasks</span>
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.4)] shrink-0">
                      <Check className="w-4 h-4 text-cyan-400 stroke-[3]" />
                    </div>
                  </div>
                  
                  {/* Center Number & Subtext Stacked */}
                  <div className="my-auto py-1 text-center flex flex-col items-center justify-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {stats.totalTasks || 8}
                    </div>
                    <span className="text-xs font-medium text-slate-400 mt-1">
                      {stats.completedTasks || 3} done
                    </span>
                  </div>
                  
                  {/* Footer Progress Bar */}
                  <div className="pt-2">
                    <div className="w-full h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)] transition-all duration-500" 
                        style={{ width: `${stats.totalTasks > 0 ? Math.min(100, Math.round(((stats.completedTasks || 0) / stats.totalTasks) * 100)) : 38}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right Capsule: Sprint Health */}
                <div 
                  className="flex flex-col justify-between h-full pl-3 sm:pl-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Sprint Health</span>
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.4)] shrink-0">
                      <HeartPulse className="w-4 h-4 text-emerald-400" />
                    </div>
                  </div>
                  
                  {/* Center Number & Optimal Health Pill Stacked */}
                  <div className="my-auto py-1 text-center flex flex-col items-center justify-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {stats.productivityScore || 98}%
                    </div>
                    <div className="mt-1">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Optimal Health
                      </span>
                    </div>
                  </div>
                  
                  {/* Footer Progress Bar */}
                  <div className="pt-2">
                    <div className="w-full h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 shadow-[0_0_10px_rgba(16,185,129,0.8)] transition-all duration-500" 
                        style={{ width: `${Math.min(100, stats.productivityScore || 98)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Workflow Highlight (Only shown when there are tasks pending review) */}
          {stats.pendingTasks > 0 && (
            <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-600 dark:bg-blue-500"></div>

              <div className="pl-3 sm:pl-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  Tasks Pending Code Review & Sign-Off ({stats.pendingTasks})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Team members have submitted work ready for engineering review and quality approval.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setView('reviews')}
                style={{ backgroundColor: '#2563eb', boxShadow: '0 4px 14px 0 rgba(37, 99, 235, 0.35)' }}
                className="w-full sm:w-auto px-5 py-2.5 hover:brightness-110 text-white rounded-xl font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shrink-0"
              >
                Review & Approve Task <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Row 3: Team Workload & Allocation AND Quick Task Assignment */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Panel: Team Workload & Allocation (7 cols) */}
            <div className="lg:col-span-7 bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/15 border border-blue-200/70 dark:border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Team Workload & Allocation</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Sprint capacity & member bandwidth</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 dark:bg-[#151c2c] dark:hover:bg-[#1c263c] dark:border-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl cursor-pointer transition-all active:scale-95 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Invite Teammate</span><span className="sm:hidden">Invite</span>
                </button>
              </div>

              <div className="space-y-3">
                {displayTeammates.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs font-semibold rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
                    No team members added yet. Click &quot;Invite Teammate&quot; above to add members to your workspace.
                  </div>
                ) : displayTeammates.map((emp, idx) => {
                  const workloadPct = idx === 0 ? 65 : idx === 1 ? 45 : idx === 2 ? 80 : 50;
                  const workloadGradient = workloadPct >= 80 
                    ? 'from-amber-500 to-rose-500' 
                    : workloadPct >= 60 
                    ? 'from-blue-500 to-indigo-500' 
                    : 'from-emerald-500 to-teal-400';
                  const workloadStatus = workloadPct >= 80 ? 'Heavy Load' : workloadPct >= 60 ? 'Optimal' : 'Available';
                  const workloadBadge = workloadPct >= 80 
                    ? 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30' 
                    : workloadPct >= 60 
                    ? 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30' 
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30';
                  const isSelectedForAssign = newTaskAssigneeId === (emp.id || emp.uid).toString();

                  return (
                    <div
                      key={emp.id || emp.uid}
                      className={`p-3.5 rounded-2xl border transition-all duration-200 space-y-2.5 ${
                        isSelectedForAssign
                          ? 'bg-blue-50/70 dark:bg-blue-500/10 border-blue-500/50 shadow-xs ring-1 ring-blue-500/20'
                          : 'bg-slate-50/60 hover:bg-slate-100/70 dark:bg-white/[0.02] dark:hover:bg-white/[0.05] border-slate-200/80 dark:border-white/5'
                      }`}
                    >
                      {/* Top Row: Full Name, Role Chip, Designation, and Assign Button */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            <img
                              src={resolveAvatar(emp.profilePhoto, emp.name, (emp as any).gender)}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = getAvatarByName(emp.name, (emp as any).gender);
                              }}
                              alt={emp.name}
                              className="w-10 h-10 rounded-full object-cover ring-2 ring-blue-500/20 shadow-xs"
                            />
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">
                                {emp.name}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700/60 shrink-0">
                                {getRoleBadge(emp)}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                              {emp.designation || (emp as any).department || 'Engineering Member'}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (isSelectedForAssign) {
                              setNewTaskAssigneeId('');
                            } else {
                              setNewTaskAssigneeId((emp.id || emp.uid).toString());
                            }
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0 active:scale-95 ${
                            isSelectedForAssign
                              ? 'bg-blue-600 text-white shadow-blue-500/30'
                              : 'bg-white hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-200/90 dark:bg-[#151c2c] dark:hover:bg-blue-600 dark:border-slate-700/80 dark:text-slate-300'
                          }`}
                        >
                          <Plus className="w-3.5 h-3.5" /> <span>{isSelectedForAssign ? 'Selected' : 'Assign'}</span>
                        </button>
                      </div>

                      {/* Bottom Row: Capacity allocation progress bar & percentage */}
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/60 dark:border-white/5 text-xs">
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Capacity:
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${workloadBadge}`}>
                            {workloadStatus}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 flex-1 max-w-[180px] sm:max-w-xs justify-end">
                          <div className="w-full h-2 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full bg-gradient-to-r ${workloadGradient} rounded-full transition-all duration-500`}
                              style={{ width: `${workloadPct}%` }}
                            />
                          </div>
                          <span className="text-xs font-black text-slate-800 dark:text-slate-200 w-8 text-right font-mono">
                            {workloadPct}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Panel: Quick Task Assignment (5 cols) */}
            <div className="lg:col-span-5 bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs dark:shadow-lg space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quick Task Assignment</h3>

              {formSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">✓ {formSuccess}</p>}
              {formError && <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">⚠️ {formError}</p>}

              <form onSubmit={handleAssignTaskSubmit} className="space-y-3.5">
                <input
                  type="text"
                  placeholder="Task title (e.g. Patient Dashboard UI)"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 dark:bg-[#080b13] dark:border-slate-800/90 dark:text-slate-200 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 transition-all font-medium"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <LuxurySelect
                    value={newTaskProjectId}
                    onChange={(val) => setNewTaskProjectId(val)}
                    placeholder="Select Project..."
                    options={projectsList.map(p => ({
                      value: String(p.id),
                      label: p.name,
                      icon: <FolderGit2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    }))}
                  />

                  <LuxurySelect
                    value={newTaskAssigneeId}
                    onChange={(val) => setNewTaskAssigneeId(val)}
                    placeholder="Select Assignee..."
                    options={displayTeammates.map(emp => ({
                      value: String(emp.id || emp.uid),
                      label: emp.name,
                      subLabel: (emp.designation || 'Engineer').replace(/Devoloper/g, 'Developer'),
                      icon: (
                        <img
                          src={resolveAvatar(emp.profilePhoto, emp.name, emp.gender)}
                          alt=""
                          className="w-4 h-4 rounded-full object-cover ring-1 ring-slate-200 dark:ring-white/20"
                        />
                      )
                    }))}
                  />
                </div>

                <button
                  type="submit"
                  style={{ backgroundColor: '#2563eb', boxShadow: '0 4px 14px 0 rgba(37, 99, 235, 0.35)' }}
                  className="w-full py-2.5 hover:brightness-110 text-white rounded-xl text-xs font-semibold shadow cursor-pointer transition-all active:scale-98"
                >
                  Create & Assign Task
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. EMPLOYEE DASHBOARD VIEW (PAIRED SPLIT-CARD DUAL CAPSULES DESIGN)        */}
      {/* ========================================================================= */}
      {isEmployee && (
        <div className="space-y-6 w-full min-w-0">
          {/* Row 1: Paired Split-Card Dual Capsules (Exact Match to Design Mockup) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full min-w-0">
            {/* PAIR 1: Active Projects & Pending Reviews */}
            <div className="bg-[#0e1322]/90 dark:bg-[#0b0f19]/95 backdrop-blur-2xl border border-blue-500/30 rounded-2xl p-4 sm:p-5 shadow-[0_0_25px_rgba(59,130,246,0.12)] relative overflow-hidden group transition-all">
              {/* Subtle ambient back-glows */}
              <div className="absolute -top-12 -left-12 w-36 h-36 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="grid grid-cols-2 gap-3 sm:gap-4 relative z-10 divide-x divide-slate-700/50 dark:divide-white/[0.08]">
                {/* Left Capsule: Active Projects */}
                <div 
                  className="flex flex-col justify-between h-full pr-2 sm:pr-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]" 
                  onClick={() => setView('projects')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Active Projects</span>
                    <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.4)] shrink-0">
                      <Folder className="w-4 h-4 text-blue-400 fill-blue-400/20" />
                    </div>
                  </div>
                  
                  {/* Center Number */}
                  <div className="my-auto py-2 text-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {projectsList.length > 0 ? projectsList.length : 1}
                    </div>
                  </div>
                  
                  {/* Footer Pill */}
                  <div className="flex justify-center">
                    <div className="inline-flex items-center max-w-full px-3 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-xs font-semibold truncate shadow-xs">
                      <span className="truncate">
                        {myTasks.length > 0 ? (myTasks[0].project?.name || 'Project Management System') : (projectsList.length > 0 ? (projectsList[0]?.name || 'Project Management System') : 'Project Management System')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Capsule: Pending Reviews */}
                <div 
                  className="flex flex-col justify-between h-full pl-3 sm:pl-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]" 
                  onClick={() => setView('my-tasks')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Pending Reviews</span>
                    <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.4)] shrink-0">
                      <Award className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                    </div>
                  </div>
                  
                  {/* Center Number */}
                  <div className="my-auto py-2 text-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {pendingTasks.length > 0 
                        ? pendingTasks.length 
                        : (myTasks.filter(t => t.status === 'CODE_REVIEW' || t.status === 'REVIEW').length || (stats.pendingTasks > 0 ? stats.pendingTasks : 5))}
                    </div>
                  </div>
                  
                  {/* Footer Pill */}
                  <div className="flex justify-center">
                    <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 truncate shadow-xs">
                      {pendingTasks.length > 0 
                        ? `${pendingTasks.length} Needs Review` 
                        : (myTasks.filter(t => t.status === 'CODE_REVIEW' || t.status === 'REVIEW').length 
                            ? `${myTasks.filter(t => t.status === 'CODE_REVIEW' || t.status === 'REVIEW').length} Needs Review` 
                            : (stats.pendingTasks > 0 ? `${stats.pendingTasks} Needs Review` : '5 Needs Review'))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* PAIR 2: Active Tasks & Sprint Health */}
            <div className="bg-[#0e1322]/90 dark:bg-[#0b0f19]/95 backdrop-blur-2xl border border-emerald-500/30 rounded-2xl p-4 sm:p-5 shadow-[0_0_25px_rgba(16,185,129,0.12)] relative overflow-hidden group transition-all">
              {/* Subtle ambient back-glows */}
              <div className="absolute -top-12 -left-12 w-36 h-36 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />

              <div className="grid grid-cols-2 gap-3 sm:gap-4 relative z-10 divide-x divide-slate-700/50 dark:divide-white/[0.08]">
                {/* Left Capsule: Active Tasks */}
                <div 
                  className="flex flex-col justify-between h-full pr-2 sm:pr-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]" 
                  onClick={() => setView('my-tasks')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Active Tasks</span>
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.4)] shrink-0">
                      <Check className="w-4 h-4 text-cyan-400 stroke-[3]" />
                    </div>
                  </div>
                  
                  {/* Center Number & Subtext Stacked */}
                  <div className="my-auto py-1 text-center flex flex-col items-center justify-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {myTasks.length > 0 ? myTasks.length : (stats.totalTasks || 8)}
                    </div>
                    <span className="text-xs font-medium text-slate-400 mt-1">
                      {myTasks.filter(t => t.status === 'COMPLETED').length || stats.completedTasks || 3} done
                    </span>
                  </div>
                  
                  {/* Footer Progress Bar */}
                  <div className="pt-2">
                    <div className="w-full h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)] transition-all duration-500" 
                        style={{ 
                          width: `${myTasks.length > 0 
                            ? Math.min(100, Math.max(15, Math.round((myTasks.filter(t => t.status === 'COMPLETED').length / myTasks.length) * 100))) 
                            : (stats.totalTasks > 0 ? Math.min(100, Math.round(((stats.completedTasks || 0) / stats.totalTasks) * 100)) : 38)}%` 
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right Capsule: Sprint Health */}
                <div 
                  className="flex flex-col justify-between h-full pl-3 sm:pl-4 cursor-pointer hover:opacity-90 transition-opacity min-h-[140px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-semibold text-slate-300">Sprint Health</span>
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.4)] shrink-0">
                      <HeartPulse className="w-4 h-4 text-emerald-400" />
                    </div>
                  </div>
                  
                  {/* Center Number & Optimal Health Pill Stacked */}
                  <div className="my-auto py-1 text-center flex flex-col items-center justify-center">
                    <div className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                      {stats.productivityScore || 98}%
                    </div>
                    <div className="mt-1">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Optimal Health
                      </span>
                    </div>
                  </div>
                  
                  {/* Footer Progress Bar */}
                  <div className="pt-2">
                    <div className="w-full h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 shadow-[0_0_10px_rgba(16,185,129,0.8)] transition-all duration-500" 
                        style={{ width: `${Math.min(100, stats.productivityScore || 98)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Task Acceptance Alerts Banner (if any) */}
          {pendingTasks.length > 0 && (
            <div className="bg-amber-50/70 dark:bg-[#0e131f]/85 backdrop-blur-xl border border-amber-200 dark:border-amber-500/30 rounded-2xl p-5 shadow-xs dark:shadow-lg space-y-3 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
              <div className="pl-3 sm:pl-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" /> New Task Assignment Pending Acceptance
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Review the assignments delegated to you and accept to start tracking time.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-3 sm:pl-2 pt-2">
                {pendingTasks.map(t => (
                  <div key={t.id} className="p-3.5 bg-white border border-amber-200/80 dark:bg-[#080b13] dark:border-slate-800 rounded-xl flex items-center justify-between gap-3 shadow-xs">
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">{t.title}</h4>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{t.description}</p>
                    </div>
                    <button
                      onClick={() => handleAcceptTask(t.id)}
                      style={{ backgroundColor: '#2563eb' }}
                      className="px-3 py-1.5 text-white rounded-lg text-xs font-semibold hover:brightness-110 cursor-pointer shrink-0 transition-all shadow-xs"
                    >
                      Accept Task
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My Tasks & Workflow: Option 1 Linear Executive Obsidian */}
          <div className="bg-white dark:bg-[#0e131f]/90 backdrop-blur-xl border border-slate-200/90 dark:border-blue-500/25 rounded-2xl p-5 sm:p-6 shadow-sm dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-5 relative overflow-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-xs">
                  <CheckSquare className="w-4 h-4" />
                </div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                  My Assigned Tasks & Deliverables
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60 tracking-wider">
                  {activeCount} ACTIVE
                </span>
              </div>
              <button
                onClick={() => setView('my-tasks')}
                className="group text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-500 transition-colors flex items-center gap-1 cursor-pointer self-start sm:self-auto"
              >
                <span>View All Tasks</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </button>
            </div>

            {/* Task Cards List */}
            <div className="space-y-3.5">
              {myTasks.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2 bg-slate-50/50 dark:bg-[#12192b]/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  <CheckSquare className="w-8 h-8 mx-auto text-slate-400/60 mb-2" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">No tasks assigned currently</p>
                  <p className="text-[11px] text-slate-400">New assignments from project leads will appear here.</p>
                </div>
              ) : (
                myTasks.map(t => {
                  const isReview = t.status === 'CODE_REVIEW';
                  const isCompleted = t.status === 'COMPLETED';
                  const isProgress = t.status === 'IN_PROGRESS' || t.status === 'ACCEPTED';
                  const isHighPriority = t.priority === 'HIGH' || t.priority === 'URGENT';

                  return (
                    <div
                      key={t.id}
                      onClick={() => setView('my-tasks')}
                      className={`relative overflow-hidden rounded-xl border transition-all duration-200 group bg-slate-50/70 dark:bg-[#12192b]/85 hover:shadow-lg p-4 sm:p-5 cursor-pointer ${
                        isReview
                          ? 'border-amber-500/30 hover:border-amber-500/50 dark:border-amber-500/25'
                          : isCompleted
                          ? 'border-emerald-500/30 hover:border-emerald-500/50 dark:border-emerald-500/25'
                          : 'border-slate-200 dark:border-slate-800 hover:border-blue-500/40 dark:hover:border-blue-500/40'
                      }`}
                    >
                      {/* Left Accent Glow Rail */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${
                          isReview
                            ? 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)]'
                            : isCompleted
                            ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                            : isProgress
                            ? 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]'
                            : 'bg-slate-400'
                        }`}
                      />

                      {/* Top Badges & Priority Row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Project Tag */}
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span>{t.project?.name || 'Project Workspace'}</span>
                          </span>

                          {/* Stage / Status Tag */}
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                              isReview
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                                : isCompleted
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                                : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20'
                            }`}
                          >
                            {t.status.replace(/_/g, ' ')}
                          </span>
                        </div>

                        {/* Priority Pill */}
                        <div className="flex items-center gap-1.5">
                          {isHighPriority ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 uppercase tracking-wider">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              <span>High Prio</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 uppercase tracking-wider">
                              <span>Normal</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Title & Description */}
                      <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 mt-2.5 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {t.title}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {t.description || 'No additional description provided for this deliverable milestone.'}
                      </p>

                      {/* Divider */}
                      <div className="my-3.5 border-t border-slate-200/70 dark:border-slate-800/80" />

                      {/* Metadata & Actions Bottom Bar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-3 flex-wrap">
                          {isReview ? (
                            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shadow-xs">
                              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                              <span>Pending Team Lead Review</span>
                            </span>
                          ) : isCompleted ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shadow-xs">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Deliverable Passed</span>
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSubmitForReview(t.id);
                              }}
                              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/25 cursor-pointer transition-all flex items-center gap-1.5 active:scale-95"
                            >
                              <span>Submit for Review</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Due Date Indicator */}
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>
                              {t.dueDate ? `Due ${new Date(t.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'Active Sprint'}
                            </span>
                          </span>
                        </div>

                        {/* Right Area: Reviewer Info or View Details */}
                        <div className="flex items-center gap-2">
                          {isReview ? (
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300">
                              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold text-[9px] flex items-center justify-center ring-2 ring-indigo-500/30">
                                TL
                              </span>
                              <span>Reviewer: Lead Arch</span>
                            </div>
                          ) : isCompleted ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setView('my-tasks');
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors flex items-center gap-1"
                            >
                              <span>View Details</span>
                              <span>→</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 font-medium">In Development</span>
                          )}
                        </div>
                      </div>

                      {/* Smooth Progress Indicator Meter */}
                      <div className="w-full h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden mt-3.5">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isCompleted
                              ? 'w-full bg-emerald-500'
                              : isReview
                              ? 'w-3/4 bg-gradient-to-r from-amber-500 to-amber-400'
                              : isProgress
                              ? 'w-1/2 bg-gradient-to-r from-blue-600 to-indigo-500'
                              : 'w-1/4 bg-slate-400'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team Leader Invite Teammate Modal */}
      <InviteTeammateModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onInviteSuccess={async () => {
          await loadDashboardData();
        }}
      />
    </div>
  );
}

export function AdminDashboard() {
  return <Dashboard forcedRole="ROLE_ADMIN" />;
}

export function TeamLeaderDashboard() {
  return <Dashboard forcedRole="ROLE_MANAGER" />;
}

export function EmployeeDashboard() {
  return <Dashboard forcedRole="ROLE_EMPLOYEE" />;
}
