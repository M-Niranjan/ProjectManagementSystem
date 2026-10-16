import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, Role } from '../models/User';
import { AuthRequest, normalizeRole } from '../middleware/auth';
import { EmailService } from '../services/emailService';
import { FirebaseAdminService, FieldValue, firebaseFirestore } from '../config/firebaseAdmin';

const JWT_SECRET = process.env.JWT_SECRET || '404E635266556A586E3272357538782F413F4428472B4B6250645367566B5970';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '86400000';

export class AuthController {
  public static async register(req: Request, res: Response) {
    try {
      const { name, email, password, workspaceCode } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
      }

      const cleanEmail = email.trim().toLowerCase();
      let user = await User.findOne({ where: { email: cleanEmail } });
      if (user) {
        return res.status(400).json({ message: 'An account with this email already exists. Please sign in.' });
      }

      const hashedPassword = await bcrypt.hash(password.trim(), 10);
      const displayName = (name && name.trim()) || cleanEmail.split('@')[0];

      user = await User.create({
        name: displayName,
        email: cleanEmail,
        password: hashedPassword,
        role: Role.ROLE_EMPLOYEE,
        status: 'active',
        designation: 'Software Engineer',
        department: 'Engineering',
        experience: 1,
        skills: 'Task Management',
      });

      // Target org
      let targetOrgId = 'org_default';
      if (workspaceCode && workspaceCode.trim()) {
        const foundOrg = await FirebaseAdminService.getOrganizationByCode(workspaceCode.trim());
        if (foundOrg) {
          targetOrgId = foundOrg.id;
        }
      }

      // Sync Firestore user doc
      try {
        await FirebaseAdminService.setFirestoreUserDoc(String(user.id), {
          uid: String(user.id),
          name: displayName,
          email: cleanEmail,
          role: 'employee',
          roleCode: Role.ROLE_EMPLOYEE,
          status: 'active',
          createdAt: new Date().toISOString(),
        });
      } catch (_fe) {}

      // Auto assign membership
      await FirebaseAdminService.autoAssignDefaultOrgMembership(String(user.id), cleanEmail, displayName, 'ROLE_EMPLOYEE', targetOrgId);

      const memberships = await FirebaseAdminService.getUserOrgMemberships(String(user.id), cleanEmail);
      const activeOrg = memberships.find(m => m.organizationId === targetOrgId) || memberships[0];

      const token = jwt.sign(
        { id: user.id, email: user.email, role: 'ROLE_EMPLOYEE', name: user.name, organizationId: activeOrg?.organizationId },
        JWT_SECRET,
        { expiresIn: `${parseInt(JWT_EXPIRATION) / 1000}s` }
      );

      const userObj = user.toJSON();
      delete userObj.password;

      return res.status(201).json({
        message: 'Account created successfully!',
        accessToken: token,
        user: { ...userObj, role: 'ROLE_EMPLOYEE' },
        orgMemberships: memberships,
        activeOrganizationId: activeOrg?.organizationId || 'org_default',
        activeOrgRole: 'ROLE_EMPLOYEE',
      });
    } catch (err: any) {
      console.error('Error in register:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async login(req: Request, res: Response) {
    try {
      const { email, password, workspaceCode } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: 'Incorrect email or password.' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const user = await User.findOne({ where: { email: cleanEmail } });

      if (!user) {
        return res.status(400).json({ message: 'Incorrect email or password.' });
      }

      const isMatch = await bcrypt.compare(password.trim(), user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Incorrect email or password.' });
      }

      // Look up real Firebase UID if available
      let resolvedUid = String(user.id);
      const fsUser = await FirebaseAdminService.getUserByEmailFromFirestore(cleanEmail);
      if (fsUser?.uid) {
        resolvedUid = fsUser.uid;
      }

      // Check user active status: reject deactivated or pending activation accounts
      const effectiveStatus = (fsUser?.status || user.status || 'active').toLowerCase();
      if (effectiveStatus === 'deactivated' || effectiveStatus === 'inactive') {
        return res.status(403).json({ message: 'Your account has been deactivated. Please contact your administrator.' });
      }
      if (effectiveStatus === 'invited') {
        return res.status(403).json({ message: 'Your account is pending activation. Please use the activation link sent to your email to set your password.' });
      }

      // Fetch org memberships from Firestore (Source of Truth)
      let memberships = await FirebaseAdminService.getUserOrgMemberships(resolvedUid, cleanEmail);

      // If user has no active memberships yet, auto-provision default organization membership
      if (!memberships || memberships.length === 0) {
        try {
          await FirebaseAdminService.autoAssignDefaultOrgMembership(
            resolvedUid,
            cleanEmail,
            user.name,
            user.role || 'ROLE_EMPLOYEE',
            'org_default'
          );
          memberships = await FirebaseAdminService.getUserOrgMemberships(resolvedUid, cleanEmail);
        } catch (_autoErr) {}
      }

      // If still empty (e.g. Firestore completely offline/fallback mode), provide safe local default membership
      if (!memberships || memberships.length === 0) {
        const canonicalRole = normalizeRole(user.role) === 'ROLE_ADMIN' ? 'admin' : normalizeRole(user.role) === 'ROLE_MANAGER' ? 'teamLeader' : 'employee';
        memberships = [{
          id: `org_default_${resolvedUid}`,
          organizationId: 'org_default',
          organizationName: 'Default Organization',
          organizationCode: 'default',
          userId: resolvedUid,
          userName: user.name || cleanEmail.split('@')[0],
          userEmail: cleanEmail,
          role: canonicalRole,
          roleCode: normalizeRole(user.role) || 'ROLE_EMPLOYEE',
          status: 'active',
        }];
      }

      // Resolve organization context
      let activeOrgId: string | null = null;
      let activeOrgRole: string | null = null;

      if (workspaceCode && typeof workspaceCode === 'string' && workspaceCode.trim()) {
        // User explicitly provided a Workspace Code (First-time onboarding or targeted login)
        const cleanCode = workspaceCode.trim().toLowerCase();
        const matched = memberships.find(m => 
          (m.organizationCode && m.organizationCode.toLowerCase() === cleanCode) || 
          m.organizationId.toLowerCase() === cleanCode
        );

        if (!matched) {
          return res.status(403).json({ message: "You don't have access to this workspace." });
        }

        if (matched.status && matched.status !== 'active') {
          return res.status(403).json({ message: "Your membership in this workspace is not active." });
        }

        const orgDoc = await FirebaseAdminService.getOrganizationDoc(matched.organizationId);
        if (orgDoc && orgDoc.status && orgDoc.status !== 'active') {
          return res.status(403).json({ message: 'This organization is currently inactive.' });
        }

        activeOrgId = matched.organizationId;
        activeOrgRole = normalizeRole(matched.roleCode || matched.role || user.role);
      } else {
        // Normal Future Login: User only provided Email + Password!
        if (memberships.length === 1) {
          // Exactly one organization: Automatically select and enter!
          const singleOrg = memberships[0];
          activeOrgId = singleOrg.organizationId;
          activeOrgRole = normalizeRole(singleOrg.roleCode || singleOrg.role || user.role);
        } else {
          // Multiple organizations: Show workspace selection screen!
          activeOrgId = null;
          activeOrgRole = null;
        }
      }

      // Requirement 25 & 26: If active organization is chosen, verify role without defaulting to employee
      if (activeOrgId && !activeOrgRole) {
        activeOrgRole = normalizeRole(user.role);
        if (!activeOrgRole) {
          return res.status(403).json({
            message: 'Your account role could not be verified. Please contact your administrator.',
          });
        }
      }

      const token = jwt.sign(
        { id: user.id, uid: resolvedUid, email: user.email, role: activeOrgRole || user.role, name: user.name, organizationId: activeOrgId },
        JWT_SECRET,
        { expiresIn: `${parseInt(JWT_EXPIRATION) / 1000}s` }
      );

      const userObj = user.toJSON();
      delete userObj.password;

      return res.json({
        accessToken: token,
        user: { ...userObj, uid: resolvedUid, role: activeOrgRole || user.role, organizationId: activeOrgId },
        orgMemberships: memberships,
        activeOrganizationId: activeOrgId,
        activeOrgRole,
        needsWorkspaceSelection: memberships.length > 1 && !activeOrgId,
      });
    } catch (err: any) {
      console.error('Error in login:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async firebaseLogin(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!idToken) return res.status(401).json({ message: 'Firebase ID token required.' });

      const { workspaceCode } = req.body;
      const decoded = await FirebaseAdminService.verifyIdToken(idToken);
      let profile: any = await FirebaseAdminService.getFirestoreUserDoc(decoded.uid);

      if (!profile && decoded.email) {
        profile = await FirebaseAdminService.getUserByEmailFromFirestore(decoded.email);
        if (profile) {
          try {
            await FirebaseAdminService.setFirestoreUserDoc(decoded.uid, {
              ...profile,
              uid: decoded.uid,
              googleUid: decoded.uid,
              email: decoded.email,
              photoURL: decoded.picture || profile.profilePhoto,
            });
          } catch (e) {
            console.warn('Could not mirror Firestore user to Google UID:', e);
          }
        }
      }

      if (!profile && decoded.email) {
        const sqliteUser = await User.findOne({ where: { email: decoded.email.trim().toLowerCase() } });
        if (sqliteUser) {
          profile = sqliteUser.toJSON();
          delete profile.password;
          try {
            await FirebaseAdminService.setFirestoreUserDoc(decoded.uid, {
              uid: decoded.uid,
              name: sqliteUser.name,
              email: sqliteUser.email,
              role: sqliteUser.role,
              designation: sqliteUser.designation,
              department: sqliteUser.department,
              skills: sqliteUser.skills,
              status: sqliteUser.status,
              createdAt: new Date().toISOString(),
            });
          } catch (e) {
            console.warn('Could not mirror SQLite user to Firestore:', e);
          }
        }
      }

      if (profile) {
        const effectiveStatus = String(profile.status || '').toLowerCase();
        if (effectiveStatus === 'deactivated' || effectiveStatus === 'inactive') {
          return res.status(403).json({ message: 'Your account has been deactivated. Please contact your organization administrator.' });
        }
        if (effectiveStatus === 'invited') {
          return res.status(403).json({ message: 'Your account is pending activation. Please use the activation link sent to your email to set your password.' });
        }
      }

      // Fetch user organization memberships from Firestore (Source of Truth)
      const email = decoded.email || '';
      let memberships = await FirebaseAdminService.getUserOrgMemberships(decoded.uid, email);

      // Multi-Organization Support: auto-provision default organization membership if needed
      if (!memberships || memberships.length === 0) {
        try {
          const defaultRoleCode = profile?.roleCode || (profile?.role === 'admin' ? 'ROLE_ADMIN' : profile?.role === 'teamLeader' ? 'ROLE_MANAGER' : 'ROLE_EMPLOYEE');
          await FirebaseAdminService.autoAssignDefaultOrgMembership(
            decoded.uid,
            email,
            decoded.name || profile?.name,
            defaultRoleCode,
            'org_default'
          );
          memberships = await FirebaseAdminService.getUserOrgMemberships(decoded.uid, email);
        } catch (_autoErr) {}
      }

      if (!memberships || memberships.length === 0) {
        const defaultRole = profile?.roleCode || 'ROLE_EMPLOYEE';
        const canonicalRole = normalizeRole(defaultRole) === 'ROLE_ADMIN' ? 'admin' : normalizeRole(defaultRole) === 'ROLE_MANAGER' ? 'teamLeader' : 'employee';
        memberships = [{
          id: `org_default_${decoded.uid}`,
          organizationId: 'org_default',
          organizationName: 'Default Organization',
          organizationCode: 'default',
          userId: decoded.uid,
          userName: decoded.name || profile?.name || email.split('@')[0],
          userEmail: email,
          role: canonicalRole,
          roleCode: normalizeRole(defaultRole) || 'ROLE_EMPLOYEE',
          status: 'active',
        }];
      }

      if (!profile) {
        // Derive role strictly from the approved membership!
        const approvedRoleNorm = normalizeRole(memberships[0].roleCode || memberships[0].role);
        if (!approvedRoleNorm) {
          return res.status(403).json({
            message: 'Your account role could not be verified. Please contact your administrator.',
          });
        }
        const approvedRole = approvedRoleNorm as Role;
        const name = decoded.name || email.split('@')[0] || 'User';
        profile = {
          uid: decoded.uid,
          name,
          email,
          role: approvedRole === Role.ROLE_ADMIN ? 'admin' : approvedRole === Role.ROLE_MANAGER ? 'teamLeader' : 'employee',
          roleCode: approvedRole,
          designation: approvedRole === Role.ROLE_ADMIN ? 'System Administrator' : approvedRole === Role.ROLE_MANAGER ? 'Project Lead' : 'Software Engineer',
          department: approvedRole === Role.ROLE_ADMIN ? 'Executive' : approvedRole === Role.ROLE_MANAGER ? 'Management' : 'Engineering',
          status: 'active',
          profilePhoto: decoded.picture || null,
          createdAt: new Date().toISOString(),
        };
        try {
          await FirebaseAdminService.setFirestoreUserDoc(decoded.uid, profile);
        } catch (_fe) {}

        // Mirror in SQLite
        try {
          const cleanEmail = email.trim().toLowerCase();
          const existing = await User.findOne({ where: { email: cleanEmail } });
          if (!existing) {
            const dummyPassword = await bcrypt.hash(`oauth_${decoded.uid}`, 10);
            await User.create({
              name,
              email: cleanEmail,
              password: dummyPassword,
              role: approvedRole,
              status: 'active',
              designation: profile.designation,
              department: profile.department,
            });
          }
        } catch (_se) {}
      }

      let activeOrgId: string | null = null;
      let activeOrgRole: string | null = null;
      let activeMembership: any = null;

      // 1. If user provided a workspaceCode / organization code, validate it (Requirement 13)
      if (workspaceCode && typeof workspaceCode === 'string' && workspaceCode.trim()) {
        const cleanCode = workspaceCode.trim().toLowerCase();
        let matched = memberships.find(m => 
          (m.organizationCode && m.organizationCode.toLowerCase() === cleanCode) || 
          m.organizationId.toLowerCase() === cleanCode
        );

        if (!matched) {
          return res.status(403).json({ message: "You don't have access to this workspace." });
        }

        if (matched.status && matched.status !== 'active') {
          return res.status(403).json({ message: "Your membership in this workspace is not active." });
        }

        const orgDoc = await FirebaseAdminService.getOrganizationDoc(matched.organizationId);
        if (orgDoc && orgDoc.status && orgDoc.status !== 'active') {
          return res.status(403).json({ message: 'This organization is currently inactive.' });
        }

        activeMembership = matched;
        activeOrgId = matched.organizationId;
        activeOrgRole = normalizeRole(matched.roleCode || matched.role || profile?.role);
      } else {
        // 2. If no workspace code was provided:
        if (memberships.length === 1) {
          const singleOrg = memberships[0];
          activeMembership = singleOrg;
          activeOrgId = singleOrg.organizationId;
          activeOrgRole = normalizeRole(singleOrg.roleCode || singleOrg.role || profile?.role);
        } else {
          // User belongs to multiple organizations: defer workspace selection
          activeOrgId = null;
          activeOrgRole = null;
        }
      }

      // Verify active organization role if activeOrgId selected
      if (activeOrgId && !activeOrgRole) {
        activeOrgRole = normalizeRole(profile?.roleCode || profile?.role);
        if (!activeOrgRole) {
          return res.status(403).json({
            message: 'Your account role could not be verified. Please contact your administrator.',
          });
        }
      }

      // If no active org selected yet (multiple orgs), resolve fallback profile role without defaulting to employee
      const resolvedRole = activeOrgRole || normalizeRole(profile?.roleCode || profile?.role);
      if (!resolvedRole && !activeOrgId && memberships.length > 1) {
        // Multi-org user selecting workspace later
      } else if (!resolvedRole) {
        return res.status(403).json({
          message: 'Your account role could not be verified. Please contact your administrator.',
        });
      }

      const token = jwt.sign(
        {
          id: decoded.uid,
          email: decoded.email || profile?.email,
          role: resolvedRole,
          name: profile?.name || decoded.name,
          organizationId: activeOrgId,
        },
        JWT_SECRET,
        { expiresIn: `${parseInt(JWT_EXPIRATION) / 1000}s` }
      );

      const userObj = {
        ...(profile || {}),
        id: decoded.uid,
        email: decoded.email || profile?.email,
        name: profile?.name || decoded.name || (decoded.email ? decoded.email.split('@')[0] : 'User'),
        role: resolvedRole,
        activeOrganizationId: activeOrgId,
      };

      return res.json({
        accessToken: token,
        user: userObj,
        orgMemberships: memberships,
        activeOrganizationId: activeOrgId,
        activeOrgRole,
        needsWorkspaceSelection: memberships.length > 1 && !activeOrgId,
      });
    } catch (err: any) {
      console.error('Error in firebaseLogin:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Invitation Verification Endpoint
  public static async getInvitation(req: Request, res: Response) {
    try {
      const token = req.query.token as string;
      if (!token || !token.trim()) {
        return res.status(400).json({ message: 'Invitation token is required.' });
      }

      const invDoc = await FirebaseAdminService.getInvitationDoc(token.trim());
      if (!invDoc) {
        return res.status(404).json({ message: 'Invalid or expired invitation link.' });
      }

      if (invDoc.status === 'accepted') {
        return res.status(400).json({ message: 'This invitation has already been accepted. Please sign in.' });
      }

      if (invDoc.expiresAt && Number(invDoc.expiresAt) < Date.now()) {
        return res.status(400).json({ message: 'This invitation link has expired. Please contact your administrator.' });
      }

      return res.json({
        valid: true,
        email: invDoc.email,
        name: invDoc.name,
        role: invDoc.role,
        roleCode: invDoc.roleCode,
        organizationId: invDoc.organizationId,
        organizationName: invDoc.organizationName,
        organizationCode: invDoc.organizationCode,
      });
    } catch (err: any) {
      console.error('Error in getInvitation:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Accept Invitation & Activate Account Endpoint
  public static async acceptInvitation(req: Request, res: Response) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: 'Invitation token and password are required.' });
      }

      const cleanPassword = String(password).trim();
      if (cleanPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
      }

      const invDoc = await FirebaseAdminService.getInvitationDoc(token.trim());
      if (!invDoc) {
        return res.status(404).json({ message: 'Invalid or expired invitation.' });
      }

      if (invDoc.status === 'accepted') {
        return res.status(400).json({ message: 'This invitation has already been accepted. Please sign in.' });
      }

      if (invDoc.expiresAt && Number(invDoc.expiresAt) < Date.now()) {
        return res.status(400).json({ message: 'This invitation link has expired. Please contact your administrator.' });
      }

      const uid = invDoc.uid;
      const orgId = invDoc.organizationId;

      // 1. Update Firebase Auth password
      await FirebaseAdminService.updateAuthUserPassword(uid, cleanPassword);

      // 2. Mark user document as active in Firestore
      await FirebaseAdminService.setFirestoreUserDoc(uid, {
        status: 'active',
        invitationAcceptedAt: FieldValue.serverTimestamp(),
      });

      // 3. Mark organization membership as active in Firestore
      if (orgId) {
        const memberDocId = `${orgId}_${uid}`;
        try {
          if (firebaseFirestore) {
            await firebaseFirestore.collection('organizationMembers').doc(memberDocId).set({
              status: 'active',
              activatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        } catch (_mErr) {}
      }

      // 4. Update SQLite record if present
      try {
        const sqlUser = await User.findOne({ where: { email: invDoc.email.toLowerCase() } });
        if (sqlUser) {
          sqlUser.password = await bcrypt.hash(cleanPassword, 10);
          sqlUser.status = 'active';
          await sqlUser.save();
        }
      } catch (_sqlErr) {}

      // 5. Mark invitation as accepted
      await FirebaseAdminService.updateInvitationDoc(token.trim(), {
        status: 'accepted',
        acceptedAt: FieldValue.serverTimestamp(),
      });

      return res.json({
        success: true,
        message: 'Account successfully activated! You can now sign in to your workspace.',
        email: invDoc.email,
        organizationName: invDoc.organizationName,
        organizationCode: invDoc.organizationCode,
      });
    } catch (err: any) {
      console.error('Error in acceptInvitation:', err);
      return res.status(500).json({ message: err.message || 'Failed to activate account.' });
    }
  }

  public static async me(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).send('Unauthorized');
      }

      const uid = req.user.uid || String(req.user.id);
      let memberships = await FirebaseAdminService.getUserOrgMemberships(uid, req.user.email);
      if (!memberships || memberships.length === 0) {
        const defaultOrg = await FirebaseAdminService.ensureDefaultOrganization();
        const canonicalRole = req.user.role === Role.ROLE_ADMIN ? 'admin' : req.user.role === Role.ROLE_MANAGER ? 'teamLeader' : 'employee';
        await FirebaseAdminService.addOrgMemberDoc(defaultOrg.id, {
          userId: uid,
          userEmail: req.user.email,
          userName: req.user.name || req.user.email.split('@')[0],
          role: canonicalRole,
          roleCode: req.user.role,
          status: 'active',
        });
        memberships = [{
          organizationId: defaultOrg.id,
          organizationName: defaultOrg.name || 'Default Organization',
          organizationCode: defaultOrg.code || 'default',
          role: canonicalRole,
          roleCode: req.user.role,
          status: 'active',
        }];
      }

      let user = null;
      try {
        if (typeof req.user.id === 'number') {
          user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['password'] },
          });
        }
      } catch (dbErr) {
        console.warn('Database error in me lookup:', dbErr);
      }

      const baseUserData = user ? user.toJSON() : {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User'),
        role: req.user.role,
        status: 'active',
      };

      return res.json({
        ...baseUserData,
        orgMemberships: memberships,
        activeOrganizationId: req.organizationId || (memberships.length === 1 ? memberships[0].organizationId : null),
      });
    } catch (err: any) {
      console.error('Error in me:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 1. Send OTP for Forgot Password
  public static async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email || !email.trim()) {
        return res.status(400).json({ message: 'Email address is required!' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const user = await User.findOne({ where: { email: cleanEmail } });

      if (!user) {
        return res.status(404).json({ message: 'No account found with this email address.' });
      }

      // Generate secure 6-digit OTP
      const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes validity

      user.otp = generatedOtp;
      user.otpExpiresAt = otpExpiresAt;
      await user.save();

      // Dispatch Email Notification with OTP
      await EmailService.sendEmailAlert(
        user.email,
        `[Project Management System] Password Reset OTP Code: ${generatedOtp}`,
        `Hello ${user.name},\n\nYour 6-digit OTP code to reset your password is: ${generatedOtp}\n\nThis code will expire in 10 minutes. If you did not request a password reset, please ignore this message.\n\nBest regards,\nProject Management Team`
      );

      return res.json({ message: '6-digit OTP verification code sent to your email address!' });
    } catch (err: any) {
      console.error('Error in forgotPassword:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. Verify 6-digit OTP
  public static async verifyOtp(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ message: 'Email and 6-digit OTP code are required!' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanOtp = otp.trim();

      const user = await User.findOne({ where: { email: cleanEmail } });
      if (!user || !user.otp) {
        return res.status(400).json({ message: 'Invalid or expired OTP code!' });
      }

      if (user.otp !== cleanOtp) {
        return res.status(400).json({ message: 'Incorrect 6-digit OTP code. Please check your inbox and try again!' });
      }

      if (user.otpExpiresAt && new Date(user.otpExpiresAt).getTime() < Date.now()) {
        return res.status(400).json({ message: 'OTP code has expired! Please request a new OTP.' });
      }

      return res.json({ message: 'OTP verified successfully! You can now enter your new password.' });
    } catch (err: any) {
      console.error('Error in verifyOtp:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. Reset Password with verified OTP
  public static async resetPassword(req: Request, res: Response) {
    try {
      const { email, otp, newPassword } = req.body;

      if (!email || !otp || !newPassword) {
        return res.status(400).json({ message: 'Email, OTP, and new password are required!' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanOtp = otp.trim();
      const cleanPassword = newPassword.trim();

      const user = await User.findOne({ where: { email: cleanEmail } });
      if (!user || !user.otp || user.otp !== cleanOtp) {
        return res.status(400).json({ message: 'Invalid or expired OTP code!' });
      }

      if (user.otpExpiresAt && new Date(user.otpExpiresAt).getTime() < Date.now()) {
        return res.status(400).json({ message: 'OTP code has expired! Please request a new OTP.' });
      }

      // Hash new password and clear OTP
      user.password = await bcrypt.hash(cleanPassword, 10);
      user.otp = null;
      user.otpExpiresAt = null;
      await user.save();

      return res.json({ message: 'Password reset successfully! Please log in with your new password.' });
    } catch (err: any) {
      console.error('Error in resetPassword:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}
