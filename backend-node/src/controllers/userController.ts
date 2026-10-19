import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { FirebaseAdminService, firebaseFirestore, FieldValue } from '../config/firebaseAdmin';

export class UserController {
  public static async getUserProfile(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id);
      const user = await User.findByPk(id, {
        attributes: { exclude: ['password'] },
      });

      if (!user) {
        return res.status(404).json({ message: `User not found: ${id}` });
      }

      return res.json(user);
    } catch (err: any) {
      console.error('Error in getUserProfile:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async updateProfile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).send('Current user not found');
      }

      let user = await User.findByPk(req.user.id);
      if (!user && req.user.email) {
        user = await User.findOne({ where: { email: req.user.email.toLowerCase() } });
      }
      if (!user && req.user.email) {
        user = await User.create({
          email: req.user.email.toLowerCase(),
          name: req.user.name || 'User',
          role: (req.user.role as any) || 'ROLE_EMPLOYEE',
          password: await bcrypt.hash(Math.random().toString(36), 10),
          status: 'active',
        });
      }
      if (!user) {
        return res.status(404).send('Current user not found');
      }

      const profileDetails = req.body;

      if (profileDetails.email && profileDetails.email.trim()) {
        const newEmail = profileDetails.email.trim().toLowerCase();
        if (newEmail !== user.email.toLowerCase()) {
          const exists = await User.findOne({ where: { email: newEmail } });
          if (exists) {
            return res.status(400).send('Email address already in use by another user!');
          }
          user.email = newEmail;
        }
      }

      if (profileDetails.name !== undefined) user.name = profileDetails.name;
      if (profileDetails.designation !== undefined) user.designation = profileDetails.designation;
      if (profileDetails.department !== undefined) user.department = profileDetails.department;
      if (profileDetails.experience !== undefined) user.experience = profileDetails.experience;
      if (profileDetails.skills !== undefined) user.skills = profileDetails.skills;
      if (profileDetails.gender !== undefined) user.gender = profileDetails.gender;
      if (profileDetails.profilePhoto !== undefined) user.profilePhoto = profileDetails.profilePhoto;
      if (profileDetails.phone !== undefined) user.phone = profileDetails.phone;
      if (profileDetails.githubUrl !== undefined) user.githubUrl = profileDetails.githubUrl;
      if (profileDetails.portfolioUrl !== undefined) user.portfolioUrl = profileDetails.portfolioUrl;
      if (profileDetails.bio !== undefined) user.bio = profileDetails.bio;
      if (profileDetails.education !== undefined) user.education = profileDetails.education;
      if (profileDetails.resumeBase64 !== undefined) user.resumeBase64 = profileDetails.resumeBase64;
      if (profileDetails.resumeFileName !== undefined) user.resumeFileName = profileDetails.resumeFileName;

      if (profileDetails.preferences !== undefined) {
        user.preferences = typeof profileDetails.preferences === 'object'
          ? JSON.stringify(profileDetails.preferences)
          : String(profileDetails.preferences);
      }

      if (profileDetails.password && profileDetails.password.trim()) {
        user.password = await bcrypt.hash(profileDetails.password.trim(), 10);
      }

      await user.save();

      // Sync to Firestore user document if available
      const resolvedUid = req.user.uid || String(user.id);
      try {
        await FirebaseAdminService.setFirestoreUserDoc(resolvedUid, {
          name: user.name,
          designation: user.designation,
          department: user.department,
          phone: user.phone,
          bio: user.bio,
          skills: user.skills,
          profilePhoto: user.profilePhoto,
          preferences: profileDetails.preferences !== undefined ? profileDetails.preferences : undefined,
        });
      } catch (fe) {
        // Firestore sync is non-blocking
      }

      const userObj: any = user.toJSON();
      delete userObj.password;

      // Parse JSON preferences if available
      if (userObj.preferences) {
        try {
          userObj.preferences = JSON.parse(userObj.preferences);
        } catch {}
      }

      return res.json(userObj);
    } catch (err: any) {
      console.error('Error in updateProfile:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async submitSupportTicket(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required.' });
      }

      const { title, category, severity, description, attachmentName, attachmentBase64 } = req.body;
      if (!title || !description) {
        return res.status(400).json({ message: 'Title and description are required for support tickets.' });
      }

      const ticketId = `TKT-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`;
      const newTicket = {
        id: ticketId,
        ticketId,
        title: title.trim(),
        category: category || 'General',
        severity: severity || 'Medium',
        description: description.trim(),
        attachmentName: attachmentName || null,
        status: 'open',
        userId: req.user.id,
        userUid: req.user.uid || String(req.user.id),
        userEmail: req.user.email,
        userName: req.user.name,
        organizationId: req.organizationId || 'default',
        createdAt: new Date().toISOString(),
      };

      // Persist to Firestore if available
      if (firebaseFirestore) {
        try {
          await firebaseFirestore.collection('support_tickets').doc(ticketId).set(newTicket);
        } catch (fe) {
          console.warn('Could not write ticket to Firestore:', fe);
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Support ticket submitted successfully.',
        ticket: newTicket,
      });
    } catch (err: any) {
      console.error('Error submitting support ticket:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}
