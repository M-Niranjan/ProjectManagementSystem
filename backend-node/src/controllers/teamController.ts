import { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User, Role } from '../models';
import { AuthRequest, normalizeRole } from '../middleware/auth';
import { FirebaseAdminService, FieldValue, firebaseFirestore, firebaseAdminAuth } from '../config/firebaseAdmin';
import { EmailService } from '../services/emailService';

export class TeamController {
  // Admin -> Provision Team Leader
  public static async createTeamLeader(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const requesterRoleNorm = normalizeRole(String(req.user.role));
      if (requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).json({ message: 'Forbidden: Only System Administrators can provision Team Leaders.' });
      }

      const { name, email, password, designation, department, status, gender, profilePhoto } = req.body;
      if (!email || !name) {
        return res.status(400).json({ message: 'Name and Email are required.' });
      }

      const cleanEmail = email.trim().toLowerCase();

      // Check duplicate email in Firebase Auth or Firestore
      const existingFirestoreUser = await FirebaseAdminService.getUserByEmailFromFirestore(cleanEmail);
      if (existingFirestoreUser) {
        return res.status(400).json({ message: 'An account with this email already exists.' });
      }

      const existingSqlUser = await User.findOne({ where: { email: cleanEmail } });
      if (existingSqlUser) {
        return res.status(400).json({ message: 'An account with this email already exists.' });
      }

      // Resolve caller's active organization context automatically
      const callerUid = req.firebaseUid || String(req.user?.uid || req.user?.id || '');
      const callerMemberships = await FirebaseAdminService.getUserOrgMemberships(callerUid, req.user.email);
      let targetOrgId: string = req.organizationId || (req.user as any)?.organizationId || '';
      if (!targetOrgId && callerMemberships.length > 0) {
        targetOrgId = callerMemberships[0].organizationId;
      }
      if (!targetOrgId) {
        const defaultOrg = await FirebaseAdminService.ensureDefaultOrganization();
        targetOrgId = defaultOrg.id;
      }

      const orgDoc = await FirebaseAdminService.getOrganizationDoc(targetOrgId);
      const orgName = orgDoc?.name || 'Default Organization';
      const orgCode = orgDoc?.code || 'default';

      // Step 1: Provision in Firebase Auth via Firebase Admin SDK (Generates Real Firebase UID)
      const fbUser = password 
        ? await FirebaseAdminService.createAuthUser(cleanEmail, password, name.trim())
        : await FirebaseAdminService.createAuthUserWithoutPassword(cleanEmail, name.trim());
      
      const uid = (fbUser as any).uid;
      const initialStatus = password ? (status || 'active') : 'invited';

      // Step 2: Atomic Creation of Firestore users/{UID} document
      try {
        await FirebaseAdminService.setFirestoreUserDoc(uid, {
          uid,
          name: name.trim(),
          email: cleanEmail,
          role: 'teamLeader',
          roleCode: Role.ROLE_MANAGER,
          organizationId: targetOrgId,
          organizationName: orgName,
          organizationCode: orgCode,
          status: initialStatus,
          designation: designation || 'Team Leader / Project Lead',
          department: department || 'Engineering',
          gender: gender || 'Male',
          profilePhoto: profilePhoto || null,
          createdBy: req.firebaseUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (fsErr) {
        console.error('Firestore creation failed, performing atomic rollback on Firebase Auth user:', fsErr);
        await FirebaseAdminService.deleteAuthUser(uid);
        return res.status(500).json({ message: 'Failed to create user profile in Firestore. Account creation rolled back.' });
      }

      // Step 3: Add newly provisioned Team Leader to the caller's active organization
      try {
        await FirebaseAdminService.addOrgMemberDoc(targetOrgId, {
          userId: uid,
          userEmail: cleanEmail,
          userName: name.trim(),
          role: 'teamLeader',
          roleCode: Role.ROLE_MANAGER,
          status: initialStatus,
          department: department || 'Engineering',
          designation: designation || 'Team Leader / Project Lead',
        });
      } catch (_orgErr) {
        console.warn('Notice: Could not assign team leader to organization:', _orgErr);
      }

      // Step 4: Create secure invitation record
      const invitationToken = crypto.randomBytes(32).toString('hex');
      try {
        await FirebaseAdminService.createInvitationDoc(invitationToken, {
          token: invitationToken,
          uid,
          email: cleanEmail,
          name: name.trim(),
          role: 'teamLeader',
          roleCode: Role.ROLE_MANAGER,
          organizationId: targetOrgId,
          organizationName: orgName,
          organizationCode: orgCode,
          status: initialStatus === 'active' ? 'accepted' : 'pending',
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          createdBy: req.firebaseUid,
        });
      } catch (invErr) {
        console.warn('Notice: Could not create invitation document:', invErr);
      }

      // Step 5: Dispatch Invitation Email with TaskFlow branding and workspace code
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
      const inviteLink = `${frontendBase}/accept-invitation?token=${invitationToken}`;
      try {
        await EmailService.sendInvitationEmail(cleanEmail, orgName, orgCode, inviteLink);
      } catch (emailErr) {
        console.warn('Notice: Could not dispatch invitation email:', emailErr);
      }

      const resetLink = await FirebaseAdminService.generatePasswordResetLink(cleanEmail);

      // Local DB sync for fallback compatibility
      const rawPass = password || Math.random().toString(36);
      const hashedPassword = await bcrypt.hash(rawPass, 10);
      let localUser: any = null;
      try {
        localUser = await User.create({
          name: name.trim(),
          email: cleanEmail,
          password: hashedPassword,
          role: Role.ROLE_MANAGER,
          designation: designation || 'Team Leader / Project Lead',
          department: department || 'Engineering',
          experience: 3,
          skills: 'Project Management',
          status: initialStatus,
          gender: gender || 'Male',
          profilePhoto: profilePhoto || null,
        });
      } catch (dbErr) {
        console.warn('Local database sync skipped, Firestore user created successfully:', dbErr);
      }

      const userObj = localUser ? localUser.toJSON() : {};
      delete userObj.password;

      // Log organizational activity in Firestore audit logs
      try {
        await FirebaseAdminService.createFirestoreAuditLog({
          user: req.user?.name || 'Administrator',
          action: 'MEMBER_CREATED',
          activity: `${req.user?.name || 'Admin'} created Team Leader ${name.trim()}`,
          status: 'VERIFIED',
          organizationId: targetOrgId,
          userId: req.user?.id,
        });
      } catch (logErr) {
        console.warn('Audit log write error:', logErr);
      }

      return res.status(201).json({
        ...userObj,
        id: uid,
        uid,
        name: name.trim(),
        email: cleanEmail,
        role: 'teamLeader',
        roleCode: Role.ROLE_MANAGER,
        organizationId: targetOrgId,
        organizationName: orgName,
        organizationCode: orgCode,
        status: initialStatus,
        createdBy: req.firebaseUid,
        resetLink,
        inviteLink,
        message: 'Team Leader account provisioned permanently in Firestore and Firebase Auth.',
      });
    } catch (err: any) {
      console.error('Error in createTeamLeader:', err);
      const message = err.message || 'Failed to create Team Leader account.';
      return res.status(err.status || 500).json({ message });
    }
  }

  public static async createEmployee(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const requesterRoleNorm = normalizeRole(String(req.user.role));
      if (requesterRoleNorm !== 'ROLE_MANAGER' && requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).json({ message: 'Forbidden: Only Team Leaders or Admins can provision Employees.' });
      }

      const requestedRole = (req.body.role || '').toLowerCase();
      if (requestedRole.includes('admin') || requestedRole.includes('manager') || requestedRole.includes('teamleader') || requestedRole.includes('lead')) {
        if (requesterRoleNorm !== 'ROLE_ADMIN') {
          return res.status(403).json({ message: 'Forbidden: Team Leaders cannot provision Team Leaders or Administrators.' });
        }
      }

      const { name, email, password, designation, department, status, teamLeaderId, gender, profilePhoto, phone, contactNumber } = req.body;
      if (!email || !name) {
        return res.status(400).json({ message: 'Name and Email are required.' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({ message: 'Please provide a valid email address format.' });
      }
      const cleanPhone = (phone || contactNumber || '').trim();

      // Check duplicate email in Firebase Auth or Firestore
      const existingFirestoreUser = await FirebaseAdminService.getUserByEmailFromFirestore(cleanEmail);
      if (existingFirestoreUser) {
        return res.status(400).json({ message: 'An account with this email already exists.' });
      }

      const existingSqlUser = await User.findOne({ where: { email: cleanEmail } });
      if (existingSqlUser) {
        return res.status(400).json({ message: 'An account with this email already exists.' });
      }

      // Resolve caller's active organization context automatically
      const callerUid = req.firebaseUid || String(req.user?.uid || req.user?.id || '');
      const callerMemberships = await FirebaseAdminService.getUserOrgMemberships(callerUid, req.user.email);
      let targetOrgId: string = req.organizationId || (req.user as any)?.organizationId || '';
      if (!targetOrgId && callerMemberships.length > 0) {
        targetOrgId = callerMemberships[0].organizationId;
      }
      if (!targetOrgId) {
        const defaultOrg = await FirebaseAdminService.ensureDefaultOrganization();
        targetOrgId = defaultOrg.id;
      }

      const orgDoc = await FirebaseAdminService.getOrganizationDoc(targetOrgId);
      const orgName = orgDoc?.name || 'Default Organization';
      const orgCode = orgDoc?.code || 'default';

      // Step 1: Provision in Firebase Auth via Admin SDK (Generates Real Firebase UID)
      const fbUser = password
        ? await FirebaseAdminService.createAuthUser(cleanEmail, password, name.trim())
        : await FirebaseAdminService.createAuthUserWithoutPassword(cleanEmail, name.trim());
      
      const uid = (fbUser as any).uid;
      const initialStatus = password ? (status || 'active') : 'invited';

      // Determine teamLeaderId
      const assignedTL = requesterRoleNorm === 'ROLE_MANAGER' 
        ? callerUid 
        : (teamLeaderId || null);

      const requestedRoleNorm = normalizeRole(req.body.role || '');
      const assignedRole = (requestedRoleNorm === 'ROLE_ADMIN' && requesterRoleNorm === 'ROLE_ADMIN') 
        ? 'admin' 
        : 'employee';
      const assignedRoleCode = assignedRole === 'admin' ? Role.ROLE_ADMIN : Role.ROLE_EMPLOYEE;

      // Step 2: Atomic Creation of Firestore users/{UID} document
      try {
        await FirebaseAdminService.setFirestoreUserDoc(uid, {
          uid,
          name: name.trim(),
          email: cleanEmail,
          phone: cleanPhone || null,
          role: assignedRole,
          roleCode: assignedRoleCode,
          organizationId: targetOrgId,
          organizationName: orgName,
          organizationCode: orgCode,
          status: initialStatus,
          invitationExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          teamLeaderId: assignedTL,
          designation: designation || (assignedRole === 'admin' ? 'System Administrator' : 'Software Engineer'),
          department: department || 'Engineering',
          gender: gender || 'Male',
          profilePhoto: profilePhoto || null,
          createdBy: req.firebaseUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (fsErr) {
        console.error('Firestore creation failed, performing atomic rollback on Firebase Auth user:', fsErr);
        await FirebaseAdminService.deleteAuthUser(uid);
        return res.status(500).json({ message: 'Failed to create user profile in Firestore. Account creation rolled back.' });
      }

      // Step 3: Add newly provisioned Employee to caller's active organization
      try {
        await FirebaseAdminService.addOrgMemberDoc(targetOrgId, {
          userId: uid,
          userEmail: cleanEmail,
          userName: name.trim(),
          role: assignedRole,
          roleCode: assignedRoleCode,
          status: initialStatus,
          department: department || 'Engineering',
          designation: designation || (assignedRole === 'admin' ? 'System Administrator' : 'Software Engineer'),
        });
      } catch (_orgErr) {
        console.warn('Notice: Could not assign employee to organization:', _orgErr);
      }

      // Step 4: Create secure invitation record
      const invitationToken = crypto.randomBytes(32).toString('hex');
      try {
        await FirebaseAdminService.createInvitationDoc(invitationToken, {
          token: invitationToken,
          uid,
          email: cleanEmail,
          name: name.trim(),
          role: assignedRole,
          roleCode: assignedRoleCode,
          organizationId: targetOrgId,
          organizationName: orgName,
          organizationCode: orgCode,
          status: initialStatus === 'active' ? 'accepted' : 'pending',
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          createdBy: req.firebaseUid,
        });
      } catch (invErr) {
        console.warn('Notice: Could not create invitation document:', invErr);
      }

      // Step 5: Dispatch Invitation Email with TaskFlow branding and workspace code
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
      const inviteLink = `${frontendBase}/accept-invitation?token=${invitationToken}`;
      try {
        await EmailService.sendInvitationEmail(cleanEmail, orgName, orgCode, inviteLink);
      } catch (emailErr) {
        console.warn('Notice: Could not dispatch invitation email:', emailErr);
      }

      const resetLink = await FirebaseAdminService.generatePasswordResetLink(cleanEmail);

      // Local DB sync for fallback compatibility
      const rawPass = password || Math.random().toString(36);
      const hashedPassword = await bcrypt.hash(rawPass, 10);
      let localUser: any = null;
      try {
        localUser = await User.create({
          name: name.trim(),
          email: cleanEmail,
          password: hashedPassword,
          role: Role.ROLE_EMPLOYEE,
          designation: designation || 'Software Engineer',
          department: department || 'Engineering',
          phone: cleanPhone || null,
          experience: 1,
          skills: 'Software Engineering',
          status: initialStatus,
          gender: gender || 'Male',
          profilePhoto: profilePhoto || null,
        });
      } catch (dbErr) {
        console.warn('Local database sync skipped, Firestore user created successfully:', dbErr);
      }

      const userObj = localUser ? localUser.toJSON() : {};
      delete userObj.password;

      // Log organizational activity in Firestore audit logs
      try {
        await FirebaseAdminService.createFirestoreAuditLog({
          user: req.user?.name || 'Administrator',
          action: 'MEMBER_CREATED',
          activity: `${req.user?.name || 'Admin'} created Employee ${name.trim()}`,
          status: 'VERIFIED',
          organizationId: targetOrgId,
          userId: req.user?.id,
        });
      } catch (logErr) {
        console.warn('Audit log write error:', logErr);
      }

      return res.status(201).json({
        ...userObj,
        id: uid,
        uid,
        name: name.trim(),
        email: cleanEmail,
        phone: cleanPhone || null,
        role: assignedRole,
        roleCode: assignedRoleCode,
        organizationId: targetOrgId,
        organizationName: orgName,
        organizationCode: orgCode,
        status: initialStatus,
        invitationExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        teamLeaderId: assignedTL,
        createdBy: req.firebaseUid,
        resetLink,
        inviteLink,
        message: initialStatus === 'invited'
          ? `Employee invitation created. Activation email sent to ${cleanEmail}.`
          : 'Employee account provisioned permanently in Firestore and Firebase Auth.',
      });
    } catch (err: any) {
      console.error('Error in createEmployee:', err);
      const message = err.message || 'Failed to create Employee account.';
      return res.status(err.status || 500).json({ message });
    }
  }

  // Unified Provision Member endpoint
  public static async createMember(req: AuthRequest, res: Response) {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
    }

    const requesterRoleNorm = normalizeRole(req.user.role);
    if (requesterRoleNorm === 'ROLE_EMPLOYEE') {
      return res.status(403).json({ message: 'Forbidden: Employees cannot provision accounts.' });
    }

    const requestedRole = (req.body.role || '').toLowerCase();
    if (requestedRole.includes('manager') || requestedRole.includes('lead') || requestedRole.includes('teamleader')) {
      return TeamController.createTeamLeader(req, res);
    }

    return TeamController.createEmployee(req, res);
  }

  // Get All Members directly from Firestore (Source of Truth) with database fallback
  public static async getAllMembers(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const callerUid = req.firebaseUid || String(req.user.uid || req.user.id || '');
      const requesterRoleNorm = normalizeRole(String(req.user.role));
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';

      let firestoreUsers: any[] = [];
      if (targetOrgId) {
        // Multi-tenant: filter users strictly belonging to this organization
        const orgUsers = await FirebaseAdminService.getFirestoreUsersByOrganization(targetOrgId);
        if (requesterRoleNorm === 'ROLE_ADMIN') {
          firestoreUsers = orgUsers;
        } else {
          // Team Leader or Employee: only users belonging to their team within this organization
          firestoreUsers = orgUsers.filter(u => u.teamLeaderId === callerUid || u.uid === callerUid || u.id === callerUid);
        }
      }

      // SQLite Fallback if firestoreUsers is empty
      if (!firestoreUsers || firestoreUsers.length === 0) {
        const sqlUsers = await User.findAll({ attributes: { exclude: ['password'] } });
        firestoreUsers = sqlUsers.map(u => ({
          id: u.id,
          uid: String(u.id),
          name: u.name,
          email: u.email,
          role: u.role === Role.ROLE_ADMIN ? 'admin' : u.role === Role.ROLE_MANAGER ? 'teamLeader' : 'employee',
          roleCode: u.role,
          designation: u.designation || 'Teammate',
          department: u.department || 'Engineering',
          status: u.status || 'active',
          experience: u.experience,
          skills: u.skills,
          gender: u.gender,
          profilePhoto: u.profilePhoto,
        }));
      }

      return res.json(firestoreUsers);
    } catch (err: any) {
      console.error('Error in getAllMembers:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Get organization invitations
  public static async getInvitations(req: AuthRequest, res: Response) {
    try {
      if (!req.user || !req.firebaseUid) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string);
      if (!targetOrgId) {
        return res.json([]);
      }
      const invitations = await FirebaseAdminService.getOrgInvitations(targetOrgId);
      return res.json(invitations);
    } catch (err: any) {
      console.error('Error in getInvitations:', err);
      return res.json([]);
    }
  }

  public static async updateMemberRole(req: AuthRequest, res: Response) {
    try {
      if (!req.user || !req.firebaseUid) return res.status(401).send('Unauthorized');

      const requesterRoleNorm = normalizeRole(req.user.role);
      if (requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).send('Forbidden: Only Administrators can modify roles.');
      }

      const targetId = req.params.id;
      const roleParam = req.query.role || req.body.role;

      if (targetId === req.user.id.toString() || targetId === req.firebaseUid) {
        return res.status(400).send('Cannot modify own role');
      }

      const roleCode = normalizeRole(String(roleParam));
      const canonicalRole = roleCode === 'ROLE_ADMIN' ? 'admin' : roleCode === 'ROLE_MANAGER' ? 'teamLeader' : 'employee';

      await FirebaseAdminService.setFirestoreUserDoc(targetId, {
        role: canonicalRole,
        roleCode: roleCode,
      });

      try {
        const user = await User.findByPk(parseInt(targetId));
        if (user) {
          user.role = roleCode as Role;
          await user.save();
        }
      } catch (e) {}

      return res.json({ message: 'Role updated successfully', role: canonicalRole, roleCode });
    } catch (err: any) {
      console.error('Error in updateMemberRole:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async updateMemberDetails(req: AuthRequest, res: Response) {
    try {
      const targetId = req.params.id;
      const { name, email, designation, department, skills, experience, profilePhoto, status } = req.body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;
      if (designation !== undefined) updateData.designation = designation;
      if (department !== undefined) updateData.department = department;
      if (skills !== undefined) updateData.skills = skills;
      if (experience !== undefined) updateData.experience = Number(experience);
      if (profilePhoto !== undefined) updateData.profilePhoto = profilePhoto;
      if (status !== undefined) updateData.status = status;

      await FirebaseAdminService.setFirestoreUserDoc(targetId, updateData);

      try {
        const user = await User.findByPk(parseInt(targetId));
        if (user) {
          if (name !== undefined) user.name = name;
          if (email !== undefined) user.email = email;
          if (designation !== undefined) user.designation = designation;
          if (department !== undefined) user.department = department;
          if (skills !== undefined) user.skills = skills;
          if (experience !== undefined) user.experience = Number(experience);
          if (profilePhoto !== undefined) user.profilePhoto = profilePhoto;
          await user.save();
        }
      } catch (e) {}

      return res.json({ message: 'Member details updated cleanly in Firestore', ...updateData });
    } catch (err: any) {
      console.error('Error in updateMemberDetails:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * POST /api/teams/resend-invitation
   * Resends an activation invitation email with a fresh 7-day token to a pending/expired employee.
   */
  public static async resendInvitation(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const requesterRoleNorm = normalizeRole(String(req.user.role));
      if (requesterRoleNorm !== 'ROLE_ADMIN' && requesterRoleNorm !== 'ROLE_MANAGER') {
        return res.status(403).json({ message: 'Forbidden: Only Administrators and Team Leaders can resend invitations.' });
      }

      const callerUid = req.firebaseUid || String(req.user?.uid || req.user?.id || '');
      const targetId = String(req.body.id || req.body.uid || req.body.employeeId || req.params?.id || '').trim();
      const targetEmail = (req.body.email || '').trim().toLowerCase();

      if (!targetId && !targetEmail) {
        return res.status(400).json({ message: 'Target Employee ID or Email is required.' });
      }

      // Fetch target user from Firestore or SQLite
      let targetUser: any = null;
      if (targetId) {
        targetUser = await FirebaseAdminService.getFirestoreUserDoc(targetId);
      }
      if (!targetUser && targetEmail) {
        targetUser = await FirebaseAdminService.getUserByEmailFromFirestore(targetEmail);
      }
      if (!targetUser) {
        try {
          const sqlUser = targetId && !isNaN(Number(targetId))
            ? await User.findByPk(Number(targetId))
            : await User.findOne({ where: { email: targetEmail || targetId } });
          if (sqlUser) {
            targetUser = {
              uid: String(sqlUser.id),
              id: String(sqlUser.id),
              name: sqlUser.name,
              email: sqlUser.email,
              role: sqlUser.role === Role.ROLE_ADMIN ? 'admin' : sqlUser.role === Role.ROLE_MANAGER ? 'teamLeader' : 'employee',
              roleCode: sqlUser.role,
              status: sqlUser.status,
            };
          }
        } catch (_dbErr) {}
      }

      if (!targetUser) {
        return res.status(404).json({ message: 'Employee record not found.' });
      }

      const targetRoleNorm = normalizeRole(String(targetUser.role || targetUser.roleCode || ''));
      if (requesterRoleNorm === 'ROLE_MANAGER') {
        if (targetRoleNorm === 'ROLE_ADMIN' || targetRoleNorm === 'ROLE_MANAGER') {
          return res.status(403).json({ message: 'Forbidden: Team Leaders cannot manage other Team Leaders or Administrators.' });
        }
        if (targetUser.teamLeaderId && targetUser.teamLeaderId !== callerUid) {
          return res.status(403).json({ message: 'Forbidden: You can only resend invitations to employees in your team.' });
        }
      }

      if (targetUser.status === 'active') {
        return res.status(400).json({ message: 'This employee account is already active. No invitation needed.' });
      }

      if (targetUser.status === 'deactivated') {
        return res.status(400).json({ message: 'This employee account is deactivated. Please reactivate the account first.' });
      }

      const cleanEmail = String(targetUser.email).trim().toLowerCase();
      const targetOrgId = targetUser.organizationId || req.organizationId || (req.user as any)?.organizationId || 'org_default';
      const orgDoc = await FirebaseAdminService.getOrganizationDoc(targetOrgId);
      const orgName = orgDoc?.name || targetUser.organizationName || 'Default Organization';
      const orgCode = orgDoc?.code || targetUser.organizationCode || 'default';

      // Generate a new secure single-use 32-byte hex crypto token
      const newToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

      await FirebaseAdminService.createInvitationDoc(newToken, {
        token: newToken,
        uid: targetUser.uid || targetUser.id,
        email: cleanEmail,
        name: targetUser.name || cleanEmail.split('@')[0],
        role: targetUser.role || 'employee',
        roleCode: targetUser.roleCode || Role.ROLE_EMPLOYEE,
        organizationId: targetOrgId,
        organizationName: orgName,
        organizationCode: orgCode,
        status: 'pending',
        expiresAt,
        createdBy: callerUid,
        resendAt: FieldValue.serverTimestamp(),
      });

      // Update user document in Firestore
      await FirebaseAdminService.setFirestoreUserDoc(targetUser.uid || targetUser.id, {
        status: 'invited',
        invitationToken: newToken,
        invitationExpiresAt: expiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Local DB sync
      try {
        const sqlUser = await User.findOne({ where: { email: cleanEmail } });
        if (sqlUser) {
          sqlUser.status = 'invited';
          await sqlUser.save();
        }
      } catch (_e) {}

      // Dispatch invitation email
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
      const inviteLink = `${frontendBase}/accept-invitation?token=${newToken}`;
      try {
        await EmailService.sendInvitationEmail(cleanEmail, orgName, orgCode, inviteLink);
      } catch (emailErr) {
        console.warn('Notice: Email dispatch error on resend:', emailErr);
      }

      // Log organizational audit log
      try {
        await FirebaseAdminService.createFirestoreAuditLog({
          user: req.user.name || 'Manager',
          action: 'INVITATION_RESENT',
          activity: `${req.user.name || 'Manager'} resent invitation to ${cleanEmail}`,
          status: 'VERIFIED',
          organizationId: targetOrgId,
          userId: req.user.id,
        });
      } catch (_logErr) {}

      return res.status(200).json({
        success: true,
        message: `Invitation email resent successfully to ${cleanEmail}.`,
        email: cleanEmail,
        inviteLink,
        expiresAt,
      });
    } catch (err: any) {
      console.error('Error in resendInvitation:', err);
      return res.status(500).json({ message: err.message || 'Failed to resend invitation.' });
    }
  }

  /**
   * PUT /api/teams/:id/status
   * Updates an employee's status (e.g. 'deactivated' or 'active').
   */
  public static async updateMemberStatus(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const requesterRoleNorm = normalizeRole(String(req.user.role));
      if (requesterRoleNorm !== 'ROLE_ADMIN' && requesterRoleNorm !== 'ROLE_MANAGER') {
        return res.status(403).json({ message: 'Forbidden: Only Administrators and Team Leaders can update member status.' });
      }

      const callerUid = req.firebaseUid || String(req.user?.uid || req.user?.id || '');
      const targetId = String(req.params.id || '').trim();
      const newStatus = (req.body.status || 'deactivated').toLowerCase().trim();

      if (!targetId) {
        return res.status(400).json({ message: 'Target ID is required.' });
      }

      if (targetId === callerUid || targetId === String(req.user.id)) {
        return res.status(400).json({ message: 'Cannot deactivate or change the status of your own account.' });
      }

      let targetDoc = await FirebaseAdminService.getFirestoreUserDoc(targetId);
      if (!targetDoc) {
        try {
          if (!isNaN(Number(targetId))) {
            const sqlU = await User.findByPk(Number(targetId));
            if (sqlU) {
              targetDoc = {
                uid: String(sqlU.id),
                id: String(sqlU.id),
                name: sqlU.name,
                email: sqlU.email,
                role: sqlU.role === Role.ROLE_ADMIN ? 'admin' : sqlU.role === Role.ROLE_MANAGER ? 'teamLeader' : 'employee',
                roleCode: sqlU.role,
                status: sqlU.status,
              };
            }
          }
        } catch (_dbE) {}
      }

      if (!targetDoc) {
        return res.status(404).json({ message: 'Member not found.' });
      }

      const targetRoleNorm = normalizeRole(String(targetDoc.role || targetDoc.roleCode || ''));
      if (requesterRoleNorm === 'ROLE_MANAGER') {
        if (targetRoleNorm === 'ROLE_ADMIN' || targetRoleNorm === 'ROLE_MANAGER') {
          return res.status(403).json({ message: 'Forbidden: Team Leaders cannot modify Administrators or other Team Leaders.' });
        }
        if (targetDoc.teamLeaderId && targetDoc.teamLeaderId !== callerUid) {
          return res.status(403).json({ message: 'Forbidden: You can only update employees assigned to your team.' });
        }
      }

      const updateData: any = {
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (newStatus === 'deactivated') {
        updateData.deactivatedAt = FieldValue.serverTimestamp();
      } else if (newStatus === 'active') {
        updateData.activatedAt = FieldValue.serverTimestamp();
      }

      // 1. Update Firestore users collection
      await FirebaseAdminService.setFirestoreUserDoc(targetId, updateData);

      // 2. Update Firestore organizationMembers collection
      const targetOrgId = targetDoc.organizationId || req.organizationId || 'org_default';
      const memberDocId = `${targetOrgId}_${targetId}`;
      if (firebaseFirestore) {
        try {
          await firebaseFirestore.collection('organizationMembers').doc(memberDocId).set({
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (_mErr) {}
      }

      // 3. Update SQLite if present
      try {
        if (!isNaN(Number(targetId))) {
          const sqlUser = await User.findByPk(Number(targetId));
          if (sqlUser) {
            sqlUser.status = newStatus;
            await sqlUser.save();
          }
        }
        if (targetDoc.email) {
          const sqlUserByEmail = await User.findOne({ where: { email: targetDoc.email.toLowerCase().trim() } });
          if (sqlUserByEmail) {
            sqlUserByEmail.status = newStatus;
            await sqlUserByEmail.save();
          }
        }
      } catch (_sErr) {}

      // Log organizational activity
      try {
        await FirebaseAdminService.createFirestoreAuditLog({
          user: req.user.name || 'Manager',
          action: newStatus === 'deactivated' ? 'MEMBER_DEACTIVATED' : 'MEMBER_ACTIVATED',
          activity: `${req.user.name || 'Manager'} marked ${targetDoc.name || targetDoc.email} as ${newStatus}`,
          status: 'VERIFIED',
          organizationId: targetOrgId,
          userId: req.user.id,
        });
      } catch (_logErr) {}

      return res.status(200).json({
        success: true,
        message: `Employee "${targetDoc.name || targetDoc.email}" has been marked as ${newStatus}.`,
        id: targetId,
        status: newStatus,
      });
    } catch (err: any) {
      console.error('Error in updateMemberStatus:', err);
      return res.status(500).json({ message: err.message || 'Failed to update member status.' });
    }
  }

  /**
   * POST /api/teams/:id/deactivate
   * Deactivates an employee account.
   */
  public static async deactivateMember(req: AuthRequest, res: Response) {
    req.body.status = 'deactivated';
    return TeamController.updateMemberStatus(req, res);
  }

  public static async deleteMember(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== Role.ROLE_ADMIN) {
        return res.status(403).json({ message: 'Forbidden: Only Administrators can delete members.' });
      }

      const targetId = String(req.params.id || '');
      const targetEmail = (req.query.email as string) || (req.body?.email as string) || '';

      let userEmail = targetEmail ? targetEmail.toLowerCase().trim() : '';

      // Check self-deletion or primary admin deletion protection
      const primaryAdminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
      const callerEmail = (req.user.email || '').toLowerCase().trim();
      if ((userEmail && userEmail === primaryAdminEmail) || (userEmail && userEmail === callerEmail)) {
        return res.status(400).json({ message: 'Cannot delete the primary administrator or your own active account.' });
      }

      // 1. Delete from SQL database if exists
      try {
        if (!isNaN(Number(targetId))) {
          const sqlUser = await User.findByPk(Number(targetId));
          if (sqlUser) {
            if (!userEmail) userEmail = sqlUser.email.toLowerCase().trim();
            await sqlUser.destroy();
          }
        }
        if (userEmail) {
          await User.destroy({ where: { email: userEmail } });
        }
      } catch (sqlErr) {
        console.warn('SQL delete user notice:', sqlErr);
      }

      // 2. Delete from Firestore by document ID
      if (targetId) {
        try {
          await FirebaseAdminService.deleteFirestoreUserDoc(targetId);
        } catch (_e) {}
      }

      // 3. Delete from Firestore by email (in case doc ID was email or random)
      if (userEmail && firebaseFirestore) {
        try {
          const snap = await firebaseFirestore.collection('users').where('email', '==', userEmail).get();
          for (const d of snap.docs) {
            await d.ref.delete();
          }
          const memberSnap = await firebaseFirestore.collection('organizationMembers').where('userEmail', '==', userEmail).get();
          for (const d of memberSnap.docs) {
            await d.ref.delete();
          }
        } catch (fsErr) {
          console.warn('Firestore email-based delete notice:', fsErr);
        }
      }

      // 4. Delete from Firebase Auth
      if (targetId) {
        try {
          await FirebaseAdminService.deleteAuthUser(targetId);
        } catch (_e) {}
      }
      if (userEmail && firebaseAdminAuth) {
        try {
          const authUser = await firebaseAdminAuth.getUserByEmail(userEmail);
          if (authUser && authUser.uid) {
            await FirebaseAdminService.deleteAuthUser(authUser.uid);
            await FirebaseAdminService.deleteFirestoreUserDoc(authUser.uid);
          }
        } catch (_e) {}
      }

      return res.json({ success: true, message: 'User permanently deleted across all databases and authentication providers.' });
    } catch (err: any) {
      console.error('Error in deleteMember:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // =========================================================================
  // TEAM LEADER -> INVITE TEAMMATE ENDPOINTS
  // =========================================================================

  /**
   * GET /api/teams/eligible-teammates
   * Returns active employees created by Admin who can be invited by the Team Leader.
   * Filters out employees already assigned to the requesting Team Leader.
   * Annotates employees assigned to other teams with their current team name.
   */
  public static async getEligibleTeammates(req: AuthRequest, res: Response) {
    try {
      const leaderUid = req.firebaseUid || String(req.user?.uid || req.user?.id || '');
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const requesterRoleNorm = normalizeRole(String(req.user.role));
      if (requesterRoleNorm !== 'ROLE_MANAGER' && requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).json({ message: 'Forbidden: Only authorized Team Leaders can access eligible teammates.' });
      }

      // Retrieve all users directly from Firestore scoped to active organization (Requirement 20)
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';
      let allUsers = await FirebaseAdminService.getFirestoreUsersByOrganization(targetOrgId);

      // Fallback to SQLite if Firestore has no users
      if (!allUsers || allUsers.length === 0) {
        const sqlUsers = await User.findAll({ attributes: { exclude: ['password'] } });
        allUsers = sqlUsers.map(u => ({
          id: u.id,
          uid: String(u.id),
          name: u.name,
          email: u.email,
          role: u.role === Role.ROLE_ADMIN ? 'admin' : u.role === Role.ROLE_MANAGER ? 'teamLeader' : 'employee',
          roleCode: u.role,
          designation: u.designation || 'Teammate',
          department: u.department || 'Engineering',
          status: u.status || 'active',
          experience: u.experience,
          skills: u.skills,
          gender: u.gender,
          profilePhoto: u.profilePhoto,
        }));
      }

      // Map Team Leaders (uid -> name) to provide current team assignment labels
      const teamLeaderMap = new Map<string, string>();
      for (const u of allUsers) {
        const r = normalizeRole(String(u.role || u.roleCode || ''));
        if (r === 'ROLE_MANAGER') {
          teamLeaderMap.set(u.uid, u.name || 'Team Leader');
        }
      }

      // Read existing invitations for this leader from Firestore team_invitations
      const currentTeamMemberUids = new Set<string>();
      if (firebaseFirestore) {
        try {
          const invSnap = await firebaseFirestore.collection('team_invitations')
            .where('teamLeaderId', '==', leaderUid)
            .get();
          invSnap.forEach(d => {
            const data = d.data();
            if (data.employeeId) currentTeamMemberUids.add(String(data.employeeId));
          });
        } catch (_invQueryErr) {
          console.warn('Notice: could not query team_invitations:', _invQueryErr);
        }
      }

      const eligibleEmployees: any[] = [];

      for (const userDoc of allUsers) {
        const userRoleNorm = normalizeRole(String(userDoc.role || userDoc.roleCode || ''));

        // Only include users whose role is employee
        if (userRoleNorm !== 'ROLE_EMPLOYEE') continue;

        const uid = String(userDoc.uid || userDoc.id);

        // Do NOT show employees already assigned to the current Team Leader
        if (userDoc.teamLeaderId === leaderUid || currentTeamMemberUids.has(uid)) {
          continue;
        }

        const isInactive = userDoc.status && String(userDoc.status).toLowerCase() === 'inactive';
        
        let isAssignedToOtherTeam = false;
        let currentTeam = 'Unassigned';
        let currentTeamLeaderId: string | null = null;
        let currentTeamLeaderName: string | null = null;

        // If assigned to another actual Team Leader
        if (userDoc.teamLeaderId && userDoc.teamLeaderId !== leaderUid && teamLeaderMap.has(userDoc.teamLeaderId)) {
          isAssignedToOtherTeam = true;
          currentTeamLeaderId = userDoc.teamLeaderId;
          currentTeamLeaderName = teamLeaderMap.get(userDoc.teamLeaderId) || 'Another Team';
          currentTeam = `${currentTeamLeaderName}'s Team`;
        }

        eligibleEmployees.push({
          id: uid,
          uid,
          name: userDoc.name || 'Teammate',
          email: userDoc.email || '',
          department: userDoc.department || 'Engineering',
          designation: userDoc.designation || 'Software Engineer',
          status: userDoc.status || 'active',
          gender: userDoc.gender || 'Male',
          profilePhoto: userDoc.profilePhoto || null,
          skills: userDoc.skills || '',
          experience: userDoc.experience || 1,
          currentTeam,
          currentTeamLeaderId,
          currentTeamLeaderName,
          isAssignedToOtherTeam,
          isAssignedToCurrentTeam: false,
          canInvite: !isInactive && !isAssignedToOtherTeam,
          createdAt: userDoc.createdAt || null,
        });
      }

      // Sort: Available (unassigned) first, then alphabetical by name
      eligibleEmployees.sort((a, b) => {
        if (a.canInvite && !b.canInvite) return -1;
        if (!a.canInvite && b.canInvite) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      return res.json(eligibleEmployees);
    } catch (err: any) {
      console.error('Error in getEligibleTeammates:', err);
      return res.status(500).json({ message: err.message || 'Failed to fetch eligible teammates from Firestore.' });
    }
  }

  /**
   * POST /api/teams/invite-teammates
   * Accepts { employeeIds: string[] } or { employeeId: string }
   * Validates Team Leader authorization from Firestore.
   * Atomically updates Firestore users/{empId} and team_invitations collection.
   */
  public static async inviteTeammates(req: AuthRequest, res: Response) {
    try {
      const leaderUid = req.firebaseUid || String(req.user?.uid || '');
      if (!leaderUid || !req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      // 1. Backend authorization validation: never trust client-supplied roles
      const leaderProfile = await FirebaseAdminService.getFirestoreUserDoc(leaderUid);
      const requesterRoleNorm = normalizeRole(String(leaderProfile?.role || leaderProfile?.roleCode || req.user.role));
      if (requesterRoleNorm !== 'ROLE_MANAGER' && requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).json({ message: 'Forbidden: Only authorized Team Leaders can invite teammates.' });
      }

      // 2. Validate employeeIds
      const rawIds = req.body.employeeIds || (req.body.employeeId ? [req.body.employeeId] : []);
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return res.status(400).json({ message: 'Please select at least one eligible employee to invite.' });
      }

      const employeeIds: string[] = rawIds.map(id => String(id).trim()).filter(Boolean);
      if (employeeIds.length === 0) {
        return res.status(400).json({ message: 'Invalid employee selection.' });
      }

      const leaderName = leaderProfile?.name || req.user.name || 'Team Leader';
      const teamId = `team_${leaderUid}`;
      const invitedResults: any[] = [];
      const errors: string[] = [];

      for (const empId of employeeIds) {
        // Fetch employee document directly from Firestore or fallback to SQLite
        let empDoc = await FirebaseAdminService.getFirestoreUserDoc(empId);
        if (!empDoc) {
          let sqlUser: any = null;
          try {
            if (!isNaN(Number(empId))) {
              sqlUser = await User.findByPk(Number(empId));
            } else {
              sqlUser = await User.findOne({ where: { email: empId.toLowerCase() } });
            }
          } catch (_dbErr) {}

          if (sqlUser) {
            empDoc = {
              uid: String(sqlUser.id),
              id: String(sqlUser.id),
              name: sqlUser.name,
              email: sqlUser.email,
              role: sqlUser.role,
              roleCode: sqlUser.role,
              status: sqlUser.status || 'active',
              department: sqlUser.department || 'Engineering',
              designation: sqlUser.designation || 'Software Engineer',
            };
          } else {
            errors.push(`Employee record (${empId}) was not found.`);
            continue;
          }
        }

        // Validate that user is indeed an employee
        const empRoleNorm = normalizeRole(String(empDoc.role || empDoc.roleCode || ''));
        if (empRoleNorm !== 'ROLE_EMPLOYEE') {
          errors.push(`${empDoc.name || empDoc.email} is not registered as an employee.`);
          continue;
        }

        // Validate active status
        if (empDoc.status && String(empDoc.status).toLowerCase() === 'inactive') {
          errors.push(`${empDoc.name || empDoc.email} is inactive and cannot join a team.`);
          continue;
        }

        // Prevent duplicate assignment to the same team
        if (empDoc.teamLeaderId === leaderUid) {
          errors.push(`${empDoc.name || empDoc.email} is already in your team.`);
          continue;
        }

        // 3. Atomically update relationship in Firestore
        // A. Update users/{empId}
        const updatedFields = {
          teamLeaderId: leaderUid,
          teamId,
          invitedBy: leaderUid,
          invitationStatus: 'ACCEPTED',
          assignedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        await FirebaseAdminService.setFirestoreUserDoc(empId, updatedFields);

        // B. Store permanent membership record in team_invitations collection
        if (firebaseFirestore) {
          try {
            const inviteDocId = `${leaderUid}_${empId}`;
            await firebaseFirestore.collection('team_invitations').doc(inviteDocId).set({
              id: inviteDocId,
              teamLeaderId: leaderUid,
              teamLeaderName: leaderName,
              teamId,
              employeeId: empId,
              employeeName: empDoc.name || '',
              employeeEmail: empDoc.email || '',
              invitedBy: leaderUid,
              invitationStatus: 'ACCEPTED',
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          } catch (invErr) {
            console.warn('Notice: Writing to team_invitations collection error:', invErr);
          }
        }

        invitedResults.push({
          id: empId,
          uid: empId,
          name: empDoc.name,
          email: empDoc.email,
          teamLeaderId: leaderUid,
          teamId,
          invitationStatus: 'ACCEPTED',
        });
      }

      if (invitedResults.length === 0) {
        return res.status(400).json({
          message: errors.join(' ') || 'No eligible teammates could be invited.',
          errors,
        });
      }

      return res.status(200).json({
        success: true,
        message: `Successfully invited ${invitedResults.length} teammate(s) to your team.`,
        invited: invitedResults,
        warnings: errors.length > 0 ? errors : undefined,
      });
    } catch (err: any) {
      console.error('Error in inviteTeammates:', err);
      return res.status(500).json({ message: err.message || 'Failed to process team invitation in Firestore.' });
    }
  }

  /**
   * POST /api/teams/remove-teammate
   * Releases an employee from the Team Leader's team back to unassigned.
   */
  public static async removeTeammate(req: AuthRequest, res: Response) {
    try {
      const leaderUid = req.firebaseUid || String(req.user?.uid || '');
      if (!leaderUid || !req.user) {
        return res.status(401).json({ message: 'Unauthorized: Authentication required.' });
      }

      const leaderProfile = await FirebaseAdminService.getFirestoreUserDoc(leaderUid);
      const requesterRoleNorm = normalizeRole(String(leaderProfile?.role || leaderProfile?.roleCode || req.user.role));
      if (requesterRoleNorm !== 'ROLE_MANAGER' && requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).json({ message: 'Forbidden: Only authorized Team Leaders can release teammates.' });
      }

      const empId = req.params.employeeId || req.body.employeeId;
      if (!empId) {
        return res.status(400).json({ message: 'Employee ID is required.' });
      }

      const empDoc = await FirebaseAdminService.getFirestoreUserDoc(empId);
      if (!empDoc) {
        return res.status(404).json({ message: 'Employee not found.' });
      }

      if (empDoc.teamLeaderId !== leaderUid && requesterRoleNorm !== 'ROLE_ADMIN') {
        return res.status(403).json({ message: 'You can only release teammates from your own team.' });
      }

      // Reset teamLeaderId to null in Firestore
      await FirebaseAdminService.setFirestoreUserDoc(empId, {
        teamLeaderId: null,
        teamId: null,
        invitationStatus: 'UNASSIGNED',
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Remove from team_invitations
      if (firebaseFirestore) {
        try {
          await firebaseFirestore.collection('team_invitations').doc(`${leaderUid}_${empId}`).delete();
        } catch (_delErr) {}
      }

      return res.json({ success: true, message: `${empDoc.name} has been removed from your team.` });
    } catch (err: any) {
      console.error('Error in removeTeammate:', err);
      return res.status(500).json({ message: err.message || 'Failed to release teammate.' });
    }
  }
}

