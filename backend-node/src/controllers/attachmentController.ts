import { Response } from 'express';
import { Attachment, User, Task, Project } from '../models';
import { AuthRequest } from '../middleware/auth';

export class AttachmentController {
  public static async uploadFile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).send('Unauthorized');
      if (!req.file) return res.status(400).send('File is empty');

      const { taskId, projectId } = req.body;
      const file = req.file;

      const host = req.get('host') || 'localhost:8080';
      const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
      const fileUrl = `${protocol}://${host}/uploads/${file.filename}`;

      let resolvedUploadedById = req.user.id;
      if (resolvedUploadedById === 900000 && req.user.email) {
        const sqlUser = await User.findOne({ where: { email: req.user.email.toLowerCase() } }).catch(() => null);
        if (sqlUser) resolvedUploadedById = sqlUser.id;
      }

      const attachment = await Attachment.create({
        fileName: file.originalname,
        fileUrl,
        fileType: file.mimetype,
        taskId: taskId ? Number(taskId) : null,
        projectId: projectId ? Number(projectId) : null,
        uploadedById: resolvedUploadedById,
      });

      const fullAttachment = await Attachment.findByPk(attachment.id, {
        include: [
          { model: User, as: 'uploadedBy', attributes: { exclude: ['password'] } },
        ],
      });

      return res.json(fullAttachment);
    } catch (err: any) {
      console.error('Error in uploadFile:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async getTaskAttachments(req: AuthRequest, res: Response) {
    try {
      const taskId = parseInt(req.params.taskId);
      const attachments = await Attachment.findAll({
        where: { taskId },
        include: [
          { model: User, as: 'uploadedBy', attributes: { exclude: ['password'] } },
        ],
      });
      return res.json(attachments);
    } catch (err: any) {
      console.error('Error in getTaskAttachments:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async getProjectAttachments(req: AuthRequest, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const attachments = await Attachment.findAll({
        where: { projectId },
        include: [
          { model: User, as: 'uploadedBy', attributes: { exclude: ['password'] } },
        ],
      });
      return res.json(attachments);
    } catch (err: any) {
      console.error('Error in getProjectAttachments:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}
