import { getAvatarByName, resolveAvatar, MEN_AVATAR, WOMEN_AVATAR } from '../services/avatar';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, UserCheck, Shield, Mail, Plus, X, Globe, Briefcase, Award, Eye, EyeOff, 
  Pencil, AlertCircle, Network, UserPlus, Trash2, LayoutGrid, Table2, UserX, 
  Send, RefreshCw, Phone, Clock, CheckCircle2, XCircle, Search 
} from 'lucide-react';
import api from '../services/api';
import { upsertFirestoreUserDoc, deleteFirestoreUserDoc, fetchAllFirestoreUserDocs } from '../services/firebase';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeRole, formatRoleName } from '../services/authRoles';
import InviteTeammateModal from '../components/InviteTeammateModal';
import { useScrollLock } from '../hooks/useScrollLock';
import LuxurySelect from '../components/common/LuxurySelect';

interface TeamMember {
  id: number | string;
  uid?: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  roleCode?: string;
  status?: string;
  invitationExpiresAt?: number;
  gender?: 'Male' | 'Female' | string;
  designation?: string;
  department?: string;
  experience?: number;
  skills?: string;
  profilePhoto?: string;
  capacityHours?: number; // Capacity per week (default 40h)
  allocatedPercent?: number; // Calculated total workload %
  createdAt?: any;
  dateAdded?: string;
  teamLeaderId?: string;
}

export default function Teams() {
  const { user, activeOrgRole, activeOrganizationId } = useAuthStore();
  const { showToast } = useUIStore();
  const userRole = normalizeRole(activeOrgRole || user?.role);
  const isAdmin = userRole === 'ROLE_ADMIN';
  const isTeamLead = userRole === 'ROLE_MANAGER';

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [memberWorkloads, setMemberWorkloads] = useState<{ [key: string]: number }>({});
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'DEACTIVATED'>('ALL');

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInviteTeammateModalOpen, setIsInviteTeammateModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  // Deletion confirmation state
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null);
  const [isDeletingMember, setIsDeletingMember] = useState(false);

  // Status update confirmation state (Deactivate / Reactivate)
  const [memberToStatusChange, setMemberToStatusChange] = useState<{ member: TeamMember; nextStatus: 'deactivated' | 'active' } | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isResending, setIsResending] = useState<string | null>(null);

  // Form states
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [specifyPassword, setSpecifyPassword] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
  const [showInvitePassword, setShowInvitePassword] = useState(false);
  const [inviteRole, setInviteRole] = useState('ROLE_EMPLOYEE');
  const [inviteDesignation, setInviteDesignation] = useState('');
  const [inviteDept, setInviteDept] = useState('Technology');
  const [inviteExp, setInviteExp] = useState(2);
  const [inviteSkills, setInviteSkills] = useState('');
  const [inviteGender, setInviteGender] = useState<'Male' | 'Female'>('Male');
  const [profilePhoto, setProfilePhoto] = useState('');

  // Teammate View details modal state
  const [viewingMember, setViewingMember] = useState<TeamMember | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  // Lock background scroll when any team modal is open
  useScrollLock(isInviteOpen || isViewOpen || isInviteTeammateModalOpen || memberToDelete !== null || memberToStatusChange !== null);

  // Profile image camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Default Mock Team
  const mockTeam: TeamMember[] = [];

  const fetchMembers = async () => {
    let teamList: any[] = [];
    let fetchSucceeded = false;
    try {
      const res = await api.get('/api/teams');
      if (res.data && Array.isArray(res.data)) {
        teamList = res.data;
        fetchSucceeded = true;
      }
    } catch (err) {
      console.warn('Backend get teams failed in Teams.tsx, trying Cloud Firestore direct:', err);
    }

    if (!fetchSucceeded && teamList.length === 0) {
      const orgId = activeOrganizationId || user?.organizationId;
      teamList = await fetchAllFirestoreUserDocs(orgId);
    }

    setMembers(teamList);

    // Compute total task allocation % for each team member
    try {
      const tasksRes = await api.get('/api/tasks');
      const allTasks = tasksRes.data || [];
      const workloads: { [key: string]: number } = {};

      teamList.forEach((m: any) => {
        let totalAlloc = 0;
        allTasks.forEach((t: any) => {
          if (t.assignee && (t.assignee.id === m.id || t.assignee.uid === m.uid || t.assignee.name === m.name)) {
            if (t.status !== 'COMPLETED') {
              totalAlloc += (t.allocationPercent || 50);
            }
          }
        });
        workloads[m.id || m.uid] = totalAlloc;
      });

      setMemberWorkloads(workloads);
    } catch (err) {
      setMemberWorkloads({});
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const getAccountStatusInfo = (member: TeamMember) => {
    const rawStatus = (member.status || 'active').toLowerCase();
    if (rawStatus === 'deactivated' || rawStatus === 'inactive') {
      return {
        key: 'deactivated',
        label: 'Deactivated',
        color: 'bg-rose-500/10 text-rose-500 border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400',
        dotColor: 'bg-rose-500',
        icon: XCircle,
      };
    }
    if (rawStatus === 'invited' || rawStatus === 'pending') {
      const isExpired = member.invitationExpiresAt && Number(member.invitationExpiresAt) < Date.now();
      if (isExpired) {
        return {
          key: 'expired',
          label: 'Invitation Expired',
          color: 'bg-red-500/10 text-red-500 border-red-500/20 dark:bg-red-500/15 dark:text-red-400',
          dotColor: 'bg-red-500',
          icon: AlertCircle,
        };
      }
      return {
        key: 'pending',
        label: 'Pending Activation',
        color: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400',
        dotColor: 'bg-amber-500',
        icon: Clock,
      };
    }
    return {
      key: 'active',
      label: 'Active',
      color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400',
      dotColor: 'bg-emerald-500',
      icon: CheckCircle2,
    };
  };

  const formatDateAdded = (member: TeamMember) => {
    const dateVal = member.createdAt || member.dateAdded;
    if (!dateVal) return '—';
    try {
      const d = typeof dateVal === 'object' && dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  const handleResendInvitation = async (member: TeamMember, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = String(member.id || member.uid);
    try {
      setIsResending(id);
      const res = await api.post('/api/teams/resend-invitation', {
        id,
        email: member.email,
      });
      showToast(res.data?.message || `Invitation email resent to ${member.email}`);
      await fetchMembers();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to resend invitation email.';
      showToast(msg, 'error');
    } finally {
      setIsResending(null);
    }
  };

  const handleOpenStatusConfirm = (member: TeamMember, nextStatus: 'deactivated' | 'active', e: React.MouseEvent) => {
    e.stopPropagation();
    setMemberToStatusChange({ member, nextStatus });
  };

  const handleConfirmStatusChange = async () => {
    if (!memberToStatusChange) return;
    const { member, nextStatus } = memberToStatusChange;
    const id = String(member.id || member.uid);
    setIsUpdatingStatus(true);
    try {
      const res = await api.put(`/api/teams/${id}/status`, { status: nextStatus });
      showToast(res.data?.message || `Employee status updated to ${nextStatus}`);
      setMemberToStatusChange(null);
      await fetchMembers();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to update employee status.';
      showToast(msg, 'error');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleOpenEdit = (member: TeamMember, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditMode(true);
    setEditingMember(member);
    setInviteName(member.name);
    setInviteEmail(member.email);
    setInvitePhone(member.phone || '');
    setSpecifyPassword(false);
    setInvitePassword('');
    setShowInvitePassword(false);
    setInviteRole(member.role);
    setInviteDesignation(member.designation || '');
    setInviteDept(member.department || 'Technology');
    setInviteExp(member.experience || 2);
    setInviteSkills(member.skills || '');
    setInviteGender((member.gender as any) || 'Male');
    setProfilePhoto(member.profilePhoto || '');
    setIsInviteOpen(true);
  };

  const handleDeleteMember = (member: TeamMember, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin) return;
    setMemberToDelete(member);
  };

  const handleConfirmDeleteMember = async () => {
    if (!memberToDelete || !isAdmin) return;
    setIsDeletingMember(true);
    try {
      const docId = String(memberToDelete.id);
      try {
        await api.delete(`/api/teams/${docId}`);
      } catch (apiErr) {
        console.warn('Backend delete team member notice:', apiErr);
      }
      await deleteFirestoreUserDoc(docId);
      setMembers(prev => prev.filter(m => String(m.id) !== docId));
      showToast(`Member "${memberToDelete.name}" removed successfully.`);
      setMemberToDelete(null);
    } catch (err: any) {
      console.error('Delete member error:', err);
      showToast(err.message || 'Failed to remove member.', 'error');
    } finally {
      setIsDeletingMember(false);
    }
  };

  const handleOpenCreate = () => {
    setIsEditMode(false);
    setEditingMember(null);
    setInviteName('');
    setInviteEmail('');
    setInvitePhone('');
    setSpecifyPassword(false);
    setInvitePassword('');
    setShowInvitePassword(false);
    setInviteRole('ROLE_EMPLOYEE');
    setInviteDesignation('');
    setInviteDept('Technology');
    setInviteExp(2);
    setInviteSkills('');
    setInviteGender('Male');
    setProfilePhoto('');
    setIsInviteOpen(true);
  };

  const handleOpenView = (member: TeamMember, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewingMember(member);
    setIsViewOpen(true);
  };

  // Profile image handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 300, height: 300 } });
      setCameraStream(stream);
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.error("Video play failed", e));
        }
      }, 100);
    } catch (err) {
      showToast("Unable to access camera. Please check device permissions.", "warning");
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 150;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, 150, 150);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setProfilePhoto(dataUrl);
        stopCamera();
      }
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsCameraActive(false);
  };

  const [modalError, setModalError] = useState<string | null>(null);

  const closeInviteModal = () => {
    stopCamera();
    setModalError(null);
    setIsInviteOpen(false);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const cleanEmail = inviteEmail.trim().toLowerCase();
    const cleanName = inviteName.trim();
    if (!cleanEmail || !cleanName) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setModalError('Please enter a valid email address format.');
      return;
    }

    if (!isEditMode && specifyPassword && (!invitePassword || invitePassword.length < 6)) {
      setModalError('Password must be at least 6 characters long!');
      return;
    }

    const defaultAvatar = inviteGender === 'Female' ? WOMEN_AVATAR : MEN_AVATAR;
    const payload: any = {
      name: cleanName,
      email: cleanEmail,
      gender: inviteGender,
      role: inviteRole,
      phone: invitePhone.trim() || undefined,
      contactNumber: invitePhone.trim() || undefined,
      designation: inviteDesignation.trim() || 'Software Engineer',
      department: inviteDept,
      experience: Number(inviteExp),
      skills: inviteSkills.trim(),
      profilePhoto: profilePhoto || defaultAvatar
    };
    if (isEditMode) {
      if (invitePassword.trim()) {
        payload.password = invitePassword.trim();
      }
    } else if (specifyPassword && invitePassword.trim()) {
      payload.password = invitePassword.trim();
    }

    if (isEditMode && editingMember) {
      const docId = String((editingMember as any).uid || editingMember.id);
      try {
        await api.put(`/api/teams/${docId}`, payload);
      } catch (err) {}
      await upsertFirestoreUserDoc(docId, payload);
      showToast(`Teammate "${cleanName}" details updated successfully.`);
    } else {
      try {
        const canonicalRole = inviteRole === 'ROLE_ADMIN' ? 'admin' : (inviteRole === 'ROLE_MANAGER' ? 'teamLeader' : 'employee');
        const endpoint = (inviteRole === 'ROLE_MANAGER' || inviteRole === 'teamLeader')
          ? '/api/users/team-leaders'
          : '/api/teams/create-employee';
        const res = await api.post(endpoint, payload);
        const createdUid = res.data?.uid || res.data?.id;
        if (createdUid) {
          await upsertFirestoreUserDoc(createdUid, {
            ...payload,
            uid: createdUid,
            role: canonicalRole,
            roleCode: inviteRole,
            status: payload.password ? 'active' : 'invited',
            invitationExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            createdAt: new Date().toISOString(),
          });
        }
        showToast(res.data?.message || `Employee account created! Activation email dispatched to ${cleanEmail}`);
      } catch (err: any) {
        const errorMsg = err.response?.data?.message || err.message || 'Account provisioning failed.';
        setModalError(errorMsg);
        return;
      }
    }
    closeInviteModal();
    await fetchMembers();
  };

  // Status counters
  let activeCount = 0;
  let pendingCount = 0;
  let expiredCount = 0;
  let deactivatedCount = 0;

  members.forEach(m => {
    const statusKey = getAccountStatusInfo(m).key;
    if (statusKey === 'active') activeCount++;
    else if (statusKey === 'pending') pendingCount++;
    else if (statusKey === 'expired') expiredCount++;
    else if (statusKey === 'deactivated') deactivatedCount++;
  });

  const filteredMembers = members.filter(m => {
    // 1. Status Filter
    const statusKey = getAccountStatusInfo(m).key;
    if (statusFilter === 'ACTIVE' && statusKey !== 'active') return false;
    if (statusFilter === 'PENDING' && statusKey !== 'pending') return false;
    if (statusFilter === 'EXPIRED' && statusKey !== 'expired') return false;
    if (statusFilter === 'DEACTIVATED' && statusKey !== 'deactivated') return false;

    // 2. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = (m.name || '').toLowerCase().includes(q);
      const matchEmail = (m.email || '').toLowerCase().includes(q);
      const matchDept = (m.department || '').toLowerCase().includes(q);
      const matchDesignation = (m.designation || '').toLowerCase().includes(q);
      const matchRole = formatRoleName(m.role).toLowerCase().includes(q);
      return matchName || matchEmail || matchDept || matchDesignation || matchRole;
    }

    return true;
  });

  return (
    <div className="space-y-4 sm:space-y-6 pb-20 lg:pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-800 dark:text-white flex items-center gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)] shrink-0">
              <Network className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2]" />
            </div>
            Team Management
          </h1>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
            Manage organization employees, invitations, designations, and account activations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View mode toggle: Table vs Grid Cards */}
          <div className="flex items-center bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200/80 dark:border-white/10">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Cards</span>
            </button>
          </div>

          {(isAdmin || isTeamLead) && (
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-500/10 cursor-pointer transition-all transform hover:-translate-y-0.5 active:scale-95"
            >
              <UserPlus className="w-4 h-4" /> Add Employee
            </button>
          )}
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/70 dark:bg-[#0e131f]/70 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search employee by name, email, department, designation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs font-semibold text-slate-800 dark:text-white placeholder:text-slate-400 outline-none focus:border-blue-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: 'All', count: members.length },
            { id: 'ACTIVE', label: 'Active', count: activeCount },
            { id: 'PENDING', label: 'Pending', count: pendingCount },
            { id: 'EXPIRED', label: 'Expired', count: expiredCount },
            { id: 'DEACTIVATED', label: 'Deactivated', count: deactivatedCount },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                statusFilter === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                statusFilter === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main View: Employee Management Table or Cards */}
      {viewMode === 'table' ? (
        <div className="bg-white dark:bg-[#0e131f]/85 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-white/5 bg-slate-50/75 dark:bg-white/[0.02] text-[10px] font-black uppercase tracking-wider text-slate-400">
                  <th className="py-3.5 px-4">Employee Name</th>
                  <th className="py-3.5 px-4">Email Address</th>
                  <th className="py-3.5 px-4">Designation</th>
                  <th className="py-3.5 px-4">Department / Team</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Account Status</th>
                  <th className="py-3.5 px-4">Date Added</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500 font-semibold">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Users className="w-8 h-8 opacity-40 stroke-[1.5]" />
                        <p className="text-sm font-bold text-slate-600 dark:text-slate-400">No employees found</p>
                        <p className="text-xs text-slate-400">Try adjusting your search query or filter</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map(member => {
                    const statusInfo = getAccountStatusInfo(member);
                    const StatusIcon = statusInfo.icon;
                    const canPerformActions = isAdmin || (isTeamLead && normalizeRole(member.role) === 'ROLE_EMPLOYEE');

                    return (
                      <tr 
                        key={member.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors group"
                      >
                        {/* Employee Name */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                              <img
                                src={resolveAvatar(member.profilePhoto, member.name, member.gender)}
                                alt={member.name}
                                className="w-9 h-9 rounded-xl object-cover ring-2 ring-blue-500/10 shadow-xs"
                              />
                              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${statusInfo.dotColor}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-black text-slate-800 dark:text-white truncate flex items-center gap-1.5">
                                <span>{member.name}</span>
                                {member.gender && (
                                  <span className="text-[9px] font-bold text-slate-400 opacity-60">
                                    {member.gender === 'Female' ? '♀' : '♂'}
                                  </span>
                                )}
                              </div>
                              {member.phone && (
                                <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1 mt-0.5 truncate">
                                  <Phone className="w-2.5 h-2.5" />
                                  <span>{member.phone}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Email Address */}
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-semibold select-text cursor-text">
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[180px] sm:max-w-[220px]">{member.email}</span>
                          </div>
                        </td>

                        {/* Designation */}
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {member.designation || 'Software Engineer'}
                          </span>
                        </td>

                        {/* Department / Team */}
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200/50 dark:border-white/5">
                            {member.department || 'Engineering'}
                          </span>
                        </td>

                        {/* Role */}
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${
                            normalizeRole(member.role) === 'ROLE_ADMIN'
                              ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                              : normalizeRole(member.role) === 'ROLE_MANAGER'
                              ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                              : 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                          }`}>
                            <Shield className="w-2.5 h-2.5" />
                            {formatRoleName(member.role, 'title')}
                          </span>
                        </td>

                        {/* Account Status */}
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold border shadow-xs ${statusInfo.color}`}>
                            <StatusIcon className="w-3 h-3 shrink-0" />
                            <span>{statusInfo.label}</span>
                          </span>
                        </td>

                        {/* Date Added */}
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400 font-semibold text-[11px] whitespace-nowrap">
                          {formatDateAdded(member)}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* View Employee */}
                            <button
                              type="button"
                              onClick={(e) => handleOpenView(member, e)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/15 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
                              title="View Employee Profile"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Edit Employee */}
                            {canPerformActions && (
                              <button
                                type="button"
                                onClick={(e) => handleOpenEdit(member, e)}
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 dark:bg-white/5 dark:hover:bg-blue-500/15 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                                title="Edit Employee Details"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Resend Invitation (only for pending or expired accounts) */}
                            {canPerformActions && (statusInfo.key === 'pending' || statusInfo.key === 'expired') && (
                              <button
                                type="button"
                                disabled={isResending === String(member.id)}
                                onClick={(e) => handleResendInvitation(member, e)}
                                className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 transition-colors cursor-pointer"
                                title="Resend Activation Invitation Email"
                              >
                                {isResending === String(member.id) ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            {/* Deactivate / Reactivate Employee */}
                            {canPerformActions && (
                              statusInfo.key === 'deactivated' ? (
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenStatusConfirm(member, 'active', e)}
                                  className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-colors cursor-pointer"
                                  title="Reactivate Employee Account"
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenStatusConfirm(member, 'deactivated', e)}
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 dark:bg-white/5 dark:hover:bg-amber-500/15 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
                                  title="Deactivate Employee"
                                >
                                  <UserX className="w-3.5 h-3.5" />
                                </button>
                              )
                            )}

                            {/* Delete Employee (Admin only permanent deletion) */}
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteMember(member, e)}
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-white/5 dark:hover:bg-rose-500/15 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                                title="Permanently Delete Teammate"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
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
      ) : (
        /* Members Grid layout */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {filteredMembers.map(member => {
            const statusInfo = getAccountStatusInfo(member);
            const canPerformActions = isAdmin || (isTeamLead && normalizeRole(member.role) === 'ROLE_EMPLOYEE');

            return (
              <div 
                key={member.id} 
                className="bg-white dark:bg-[#0e131f]/85 border border-slate-200/90 dark:border-slate-800/80 rounded-2xl shadow-sm hover:shadow-md transition-all p-5 sm:p-6 flex flex-col justify-between min-h-[220px] relative group"
              >
                {/* Status badge top-left */}
                <div className="absolute top-4 left-4 z-10">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${statusInfo.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotColor}`} />
                    <span>{statusInfo.label}</span>
                  </span>
                </div>

                {/* Hover card action icons overlay */}
                <div className="absolute top-4 right-4 flex items-center gap-1.5 z-10">
                  <button
                    type="button"
                    onClick={(e) => handleOpenView(member, e)}
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/15 text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
                    title="View Teammate Details"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>

                  {canPerformActions && (
                    <button
                      type="button"
                      onClick={(e) => handleOpenEdit(member, e)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 dark:bg-white/5 dark:hover:bg-blue-500/15 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer"
                      title="Edit Teammate"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {canPerformActions && (statusInfo.key === 'pending' || statusInfo.key === 'expired') && (
                    <button
                      type="button"
                      disabled={isResending === String(member.id)}
                      onClick={(e) => handleResendInvitation(member, e)}
                      className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 transition-colors cursor-pointer"
                      title="Resend Activation Invitation Email"
                    >
                      {isResending === String(member.id) ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  {canPerformActions && (
                    statusInfo.key === 'deactivated' ? (
                      <button
                        type="button"
                        onClick={(e) => handleOpenStatusConfirm(member, 'active', e)}
                        className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 transition-colors cursor-pointer"
                        title="Reactivate Employee"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleOpenStatusConfirm(member, 'deactivated', e)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 dark:bg-white/5 dark:hover:bg-amber-500/15 text-slate-400 hover:text-amber-500 transition-colors cursor-pointer"
                        title="Deactivate Employee"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteMember(member, e)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-white/5 dark:hover:bg-rose-500/15 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                      title="Delete Teammate"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex gap-4 pt-6">
                  <div className="relative flex-shrink-0">
                    <img
                      src={resolveAvatar(member.profilePhoto, member.name, member.gender)}
                      alt="Avatar"
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover ring-2 ring-blue-500/10"
                    />
                    <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${statusInfo.dotColor}`}></span>
                  </div>
                  <div className="min-w-0 pr-12">
                    <h3 className="text-sm font-black text-slate-800 dark:text-white truncate">{member.name}</h3>
                    <p className="text-[11px] font-bold text-blue-600 dark:text-blue-400 mt-0.5 truncate">{member.designation || 'Software Engineer'}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 tracking-wider truncate">{member.department || 'Engineering'}</p>
                    {member.phone && (
                      <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1 mt-0.5 truncate">
                        <Phone className="w-2.5 h-2.5" /> {member.phone}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3 border-t border-slate-100 dark:border-white/5 pt-4 mt-4">
                  {/* PDF Spec: Resource Capacity & Workload Allocation Bar */}
                  {(() => {
                    const workloadPercent = memberWorkloads[member.id] || 0;
                    const isOverallocated = workloadPercent > 100;
                    const capacityHours = Math.round((workloadPercent / 100) * 40);

                    return (
                      <div className="space-y-1.5 bg-slate-50 dark:bg-white/[0.03] p-2.5 rounded-xl border border-slate-200/70 dark:border-white/5">
                        <div className="flex justify-between items-center text-[10px] font-black">
                          <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            ⚡ Workload Allocation
                          </span>
                          <span className={isOverallocated ? 'text-red-500 font-extrabold animate-pulse' : 'text-slate-700 dark:text-slate-200'}>
                            {workloadPercent}% {isOverallocated ? '⚠️ Overbooked' : `(${capacityHours}h/40h)`}
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isOverallocated
                                ? 'bg-gradient-to-r from-amber-500 to-red-500 shadow-md shadow-red-500/30'
                                : workloadPercent > 70
                                ? 'bg-gradient-to-r from-blue-500 to-amber-500'
                                : 'bg-gradient-to-r from-blue-600 to-indigo-600'
                            }`}
                            style={{ width: `${Math.min(100, workloadPercent)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1.5 truncate pr-2">
                      <Mail className="w-3.5 h-3.5 text-slate-400" /> {member.email}
                    </span>
                    
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Shield className="w-3.5 h-3.5 text-blue-500" /> {formatRoleName(member.role, 'title')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invite / Edit Teammate Modal */}
      <AnimatePresence>
        {isInviteOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 touch-none overscroll-contain select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeInviteModal}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm touch-none overscroll-none"
            ></motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="glass-panel w-full max-w-sm p-6 shadow-2xl relative border border-slate-200/50 dark:border-white/10 overflow-y-auto max-h-[90vh] modal-dialog-contain overscroll-contain"
            >
              <button
                onClick={closeInviteModal}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="text-md font-black text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-blue-500" /> {isEditMode ? 'Edit Teammate Profile' : 'Invite Organization Teammate'}
              </h2>

              <form onSubmit={handleInvite} className="space-y-4">
                {modalError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-xs font-bold flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{modalError}</span>
                  </div>
                )}
                {/* Profile Photo selector & Camera capture */}
                <div className="flex flex-col items-center space-y-3 p-3 bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-2xl">
                  <div className="relative">
                    {isCameraActive ? (
                      <video 
                        ref={videoRef} 
                        className="w-16 h-16 rounded-xl object-cover ring-2 ring-blue-500 bg-black"
                        playsInline
                        muted
                      />
                    ) : (
                      <img
                        src={resolveAvatar(profilePhoto, inviteName, inviteGender)}
                        alt="Teammate avatar preview"
                        className="w-16 h-16 rounded-xl object-cover ring-2 ring-blue-500/20 shadow-md"
                      />
                    )}
                  </div>
                  
                  <div className="flex flex-wrap justify-center gap-2">
                    <input 
                      type="file" 
                      id="fileInput" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleFileChange} 
                    />
                    <label 
                      htmlFor="fileInput"
                      className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-slate-200/50 dark:border-white/5 text-[10px] font-black text-slate-600 dark:text-slate-300 rounded-lg cursor-pointer transition-colors"
                    >
                      Choose Photo
                    </label>

                    {isCameraActive ? (
                      <>
                        <button
                          type="button"
                          onClick={capturePhoto}
                          className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-[10px] font-black rounded-lg cursor-pointer transition-colors"
                        >
                          Capture
                        </button>
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-[10px] font-black rounded-lg cursor-pointer transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-slate-200/50 dark:border-white/5 text-[10px] font-black text-slate-600 dark:text-slate-300 rounded-lg cursor-pointer transition-colors"
                      >
                        Use Camera
                      </button>
                    )}

                    {profilePhoto && (
                      <button
                        type="button"
                        onClick={() => setProfilePhoto('')}
                        className="px-3 py-1 bg-red-500/10 text-red-500 hover:bg-red-500/15 text-[10px] font-black rounded-lg cursor-pointer transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Gender selector for Admin and Team Leader */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center justify-between">
                    <span>Gender (Profile Icon)</span>
                    <span className="text-[9px] text-blue-500 dark:text-blue-400 normal-case font-bold">Auto-sets default avatar</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setInviteGender('Male');
                        if (!profilePhoto || profilePhoto === WOMEN_AVATAR) {
                          setProfilePhoto(MEN_AVATAR);
                        }
                      }}
                      className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all cursor-pointer ${
                        inviteGender === 'Male'
                          ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20'
                          : 'border-slate-200/50 dark:border-white/5 bg-white/5 hover:bg-white/10 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <img src={MEN_AVATAR} alt="Male Icon" className="w-8 h-8 rounded-lg object-cover ring-1 ring-blue-500/30 shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="text-xs font-black">Male</p>
                        <p className="text-[9px] opacity-75">Men Icon</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setInviteGender('Female');
                        if (!profilePhoto || profilePhoto === MEN_AVATAR) {
                          setProfilePhoto(WOMEN_AVATAR);
                        }
                      }}
                      className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all cursor-pointer ${
                        inviteGender === 'Female'
                          ? 'border-pink-500 bg-pink-500/15 text-pink-600 dark:text-pink-400 ring-2 ring-pink-500/20'
                          : 'border-slate-200/50 dark:border-white/5 bg-white/5 hover:bg-white/10 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <img src={WOMEN_AVATAR} alt="Female Icon" className="w-8 h-8 rounded-lg object-cover ring-1 ring-pink-500/30 shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="text-xs font-black">Female</p>
                        <p className="text-[9px] opacity-75">Women Icon</p>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="jane@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center justify-between">
                    <span>Contact Number</span>
                    <span className="text-[9px] text-slate-400 normal-case font-medium">Optional</span>
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                  />
                </div>

                {!isEditMode ? (
                  <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-blue-500" />
                        <div>
                          <p className="text-xs font-black text-slate-800 dark:text-white">Email Invitation Workflow</p>
                          <p className="text-[10px] text-slate-400 font-medium">Employee configures confidential password on activation</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={specifyPassword}
                          onChange={(e) => setSpecifyPassword(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {!specifyPassword ? (
                      <div className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-xl p-2.5 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                        <span>A secure, 7-day activation link will be automatically sent to this employee. They will choose their own password upon activation.</span>
                      </div>
                    ) : (
                      <div className="space-y-1 pt-1.5 border-t border-slate-200/50 dark:border-white/5">
                        <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                          Initial Password
                        </label>
                        <div className="relative">
                          <input
                            type={showInvitePassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            placeholder="Set initial password (min 6 characters)"
                            value={invitePassword}
                            onChange={(e) => setInvitePassword(e.target.value)}
                            className="w-full pl-4 pr-10 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 transition-all font-semibold text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setShowInvitePassword(!showInvitePassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                            title={showInvitePassword ? "Hide password" : "Show password"}
                          >
                            {showInvitePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                      New Password (Optional - Leave blank to keep current)
                    </label>
                    <div className="relative">
                      <input
                        type={showInvitePassword ? 'text' : 'password'}
                        minLength={6}
                        placeholder="•••••••• (unchanged)"
                        value={invitePassword}
                        onChange={(e) => setInvitePassword(e.target.value)}
                        className="w-full pl-4 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowInvitePassword(!showInvitePassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                        title={showInvitePassword ? "Hide password" : "Show password"}
                      >
                        {showInvitePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Designation</label>
                    <input
                      type="text"
                      placeholder="e.g. Lead Designer"
                      value={inviteDesignation}
                      onChange={(e) => setInviteDesignation(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Department</label>
                    <LuxurySelect
                      value={inviteDept}
                      onChange={(val) => setInviteDept(val)}
                      options={[
                        { value: 'Technology', label: 'Technology' },
                        { value: 'Product Design', label: 'Product Design' },
                        { value: 'Marketing', label: 'Marketing' },
                        { value: 'Sales', label: 'Sales' },
                        { value: 'Operations', label: 'Operations' }
                      ]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center justify-between">
                      <span>Security Role</span>
                      {isTeamLead && !isAdmin && (
                        <span className="text-[9px] text-amber-500 normal-case font-bold">Scoped to Employee</span>
                      )}
                    </label>
                    <LuxurySelect
                      value={inviteRole}
                      onChange={(val) => setInviteRole(val)}
                      disabled={isTeamLead && !isAdmin}
                      options={
                        isTeamLead && !isAdmin
                          ? [
                              { value: 'ROLE_EMPLOYEE', label: 'Employee', badge: 'MEMBER', badgeColor: 'bg-blue-500/20 text-blue-400' }
                            ]
                          : [
                              { value: 'ROLE_EMPLOYEE', label: 'Employee', badge: 'MEMBER', badgeColor: 'bg-blue-500/20 text-blue-400' },
                              { value: 'ROLE_MANAGER', label: 'Team Lead', badge: 'LEAD', badgeColor: 'bg-amber-500/20 text-amber-400' },
                              { value: 'ROLE_ADMIN', label: 'Admin', badge: 'ADMIN', badgeColor: 'bg-rose-500/20 text-rose-400' }
                            ]
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Experience (Yrs)</label>
                    <input
                      type="number"
                      value={inviteExp}
                      onChange={(e) => setInviteExp(Number(e.target.value))}
                      className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Competencies (Comma separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. React, Node, CSS"
                    value={inviteSkills}
                    onChange={(e) => setInviteSkills(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-semibold text-xs"
                  />
                </div>

                <div className="flex gap-3 justify-end pt-4 mt-6">
                  <button
                    type="button"
                    onClick={closeInviteModal}
                    className="px-4 py-2 border border-slate-200 dark:border-white/10 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-bold text-xs cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs cursor-pointer shadow-lg shadow-blue-500/10 transition-colors"
                  >
                    {isEditMode ? 'Save Profile Changes' : (specifyPassword ? 'Create Account' : 'Send Invitation')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Teammate Details Modal */}
      <AnimatePresence>
        {isViewOpen && viewingMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 touch-none overscroll-contain select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsViewOpen(false)}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm touch-none overscroll-none"
            ></motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="glass-panel w-full max-w-sm max-h-[88vh] overflow-y-auto p-6 shadow-2xl relative border border-slate-200/50 dark:border-white/10 text-center space-y-6 modal-dialog-contain overscroll-contain"
            >
              <button
                onClick={() => setIsViewOpen(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center space-y-3">
                <div className="relative">
                  <img
                    src={resolveAvatar(viewingMember.profilePhoto, viewingMember.name, viewingMember.gender)}
                    alt="avatar"
                    className="w-20 h-20 rounded-2xl object-cover ring-2 ring-blue-500/20 shadow-lg"
                  />
                  <span className="absolute bottom-0 right-0 w-4.5 h-4.5 rounded-full bg-green-500 border-4 border-slate-200 dark:border-slate-900 animate-pulse"></span>
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800 dark:text-white">{viewingMember.name}</h3>
                  <p className="text-xs font-bold text-blue-500 mt-0.5">{viewingMember.designation || 'Software Engineer'}</p>
                  {viewingMember.gender && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 border border-slate-200/40 dark:border-white/10 text-slate-500 dark:text-slate-400">
                      {viewingMember.gender}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 text-left text-xs font-bold text-slate-600 dark:text-slate-300">
                <div className="flex justify-between items-center border-b border-slate-200/30 dark:border-white/5 pb-2">
                  <span className="text-slate-400">Account Status</span>
                  {(() => {
                    const statusInfo = getAccountStatusInfo(viewingMember);
                    const StatusIcon = statusInfo.icon;
                    return (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black border ${statusInfo.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotColor}`} />
                        <StatusIcon className="w-3 h-3" />
                        <span>{statusInfo.label}</span>
                      </span>
                    );
                  })()}
                </div>
                <div className="flex justify-between border-b border-slate-200/30 dark:border-white/5 pb-2">
                  <span className="text-slate-400">Department</span>
                  <span>{viewingMember.department || 'Technology'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200/30 dark:border-white/5 pb-2">
                  <span className="text-slate-400">Email Contact</span>
                  <span className="text-slate-800 dark:text-white select-text cursor-text">{viewingMember.email}</span>
                </div>
                {viewingMember.phone && (
                  <div className="flex justify-between border-b border-slate-200/30 dark:border-white/5 pb-2">
                    <span className="text-slate-400">Phone Contact</span>
                    <span className="text-slate-800 dark:text-white select-text cursor-text">{viewingMember.phone}</span>
                  </div>
                )}
                <div className="flex justify-between border-b border-slate-200/30 dark:border-white/5 pb-2">
                  <span className="text-slate-400">Role level</span>
                  <span className="text-blue-500">{formatRoleName(viewingMember.role, 'title')}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200/30 dark:border-white/5 pb-2">
                  <span className="text-slate-400">Date Added</span>
                  <span className="text-slate-700 dark:text-slate-300 font-semibold">{formatDateAdded(viewingMember)}</span>
                </div>
                {viewingMember.experience !== undefined && (
                  <div className="flex justify-between border-b border-slate-200/30 dark:border-white/5 pb-2">
                    <span className="text-slate-400">Experience</span>
                    <span>{viewingMember.experience} Years</span>
                  </div>
                )}
                {viewingMember.skills && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block">Competencies</span>
                    <div className="flex flex-wrap gap-1">
                      {viewingMember.skills.split(',').map(s => (
                        <span key={s} className="px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-lg text-[9px] font-black border border-blue-500/15">
                          {s.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setIsViewOpen(false)}
                  className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-500/10 cursor-pointer"
                >
                  Close Profile
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Member Confirmation Modal */}
      <AnimatePresence>
        {memberToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeletingMember && setMemberToDelete(null)}
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md relative z-10 shadow-2xl border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-800 dark:text-white">
                      Delete Team Member
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Permanent deletion confirmation
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isDeletingMember}
                  onClick={() => setMemberToDelete(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/5 rounded-2xl flex items-center gap-3">
                <img
                  src={resolveAvatar(memberToDelete.profilePhoto, memberToDelete.name || memberToDelete.email, memberToDelete.gender)}
                  alt="avatar"
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-rose-500/20"
                />
                <div className="min-w-0">
                  <p className="font-black text-sm text-slate-800 dark:text-white truncate">
                    {memberToDelete.name}
                  </p>
                  <p className="text-[11px] text-slate-400 font-semibold truncate">
                    {memberToDelete.email}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Are you sure you want to remove <strong className="text-slate-900 dark:text-white font-bold">{memberToDelete.name}</strong> from the organization? This action will remove their access to project workflows and cannot be undone.
              </p>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-white/5">
                <button
                  type="button"
                  disabled={isDeletingMember}
                  onClick={() => setMemberToDelete(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingMember}
                  onClick={handleConfirmDeleteMember}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-500/20 cursor-pointer transition-all flex items-center gap-2"
                >
                  {isDeletingMember ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Deactivate / Reactivate Member Confirmation Modal */}
      <AnimatePresence>
        {memberToStatusChange && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isUpdatingStatus && setMemberToStatusChange(null)}
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md relative z-10 shadow-2xl border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                    memberToStatusChange.nextStatus === 'deactivated'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                  }`}>
                    {memberToStatusChange.nextStatus === 'deactivated' ? (
                      <UserX className="w-5 h-5" />
                    ) : (
                      <UserCheck className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-800 dark:text-white">
                      {memberToStatusChange.nextStatus === 'deactivated' ? 'Deactivate Employee' : 'Reactivate Employee'}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {memberToStatusChange.nextStatus === 'deactivated' ? 'Suspends employee account access' : 'Restores employee account access'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isUpdatingStatus}
                  onClick={() => setMemberToStatusChange(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/5 rounded-2xl flex items-center gap-3">
                <img
                  src={resolveAvatar(memberToStatusChange.member.profilePhoto, memberToStatusChange.member.name || memberToStatusChange.member.email, memberToStatusChange.member.gender)}
                  alt="avatar"
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-slate-200 dark:ring-white/10"
                />
                <div className="min-w-0">
                  <p className="font-black text-sm text-slate-800 dark:text-white truncate">
                    {memberToStatusChange.member.name}
                  </p>
                  <p className="text-[11px] text-slate-400 font-semibold truncate">
                    {memberToStatusChange.member.email}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {memberToStatusChange.nextStatus === 'deactivated' ? (
                  <>
                    Are you sure you want to deactivate <strong className="text-slate-900 dark:text-white font-bold">{memberToStatusChange.member.name}</strong>? They will be unable to log in to the system until an administrator or team leader reactivates their account.
                  </>
                ) : (
                  <>
                    Are you sure you want to reactivate <strong className="text-slate-900 dark:text-white font-bold">{memberToStatusChange.member.name}</strong>? Their login access and team participation will be restored immediately.
                  </>
                )}
              </p>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-white/5">
                <button
                  type="button"
                  disabled={isUpdatingStatus}
                  onClick={() => setMemberToStatusChange(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isUpdatingStatus}
                  onClick={handleConfirmStatusChange}
                  className={`px-4 py-2 rounded-xl text-white text-xs font-bold shadow-md cursor-pointer transition-all flex items-center gap-2 ${
                    memberToStatusChange.nextStatus === 'deactivated'
                      ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20'
                      : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20'
                  }`}
                >
                  {isUpdatingStatus ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      {memberToStatusChange.nextStatus === 'deactivated' ? (
                        <UserX className="w-3.5 h-3.5" />
                      ) : (
                        <UserCheck className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {memberToStatusChange.nextStatus === 'deactivated' ? 'Confirm Deactivation' : 'Confirm Reactivation'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Invite Teammate Modal for Team Leader & Team Hub */}
      <InviteTeammateModal
        isOpen={isInviteTeammateModalOpen}
        onClose={() => setIsInviteTeammateModalOpen(false)}
        onInviteSuccess={async () => {
          await fetchMembers();
        }}
      />
    </div>
  );
}
