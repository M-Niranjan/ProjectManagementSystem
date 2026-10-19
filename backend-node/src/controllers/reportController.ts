import { Response } from 'express';
import { Project, Task } from '../models';
import { AuthRequest } from '../middleware/auth';
import { ReportService } from '../services/reportService';

export class ReportController {
  public static async getAnalytics(req: AuthRequest, res: Response) {
    try {
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string);
      const projectWhere: any = {};
      if (targetOrgId) {
        projectWhere.organizationId = targetOrgId;
      }

      const projects = await Project.findAll({ where: projectWhere });
      const projectIds = projects.map((p) => p.id);
      const tasks = projectIds.length > 0 
        ? await Task.findAll({ where: { projectId: projectIds } }) 
        : [];

      const totalProjects = projects.length;
      const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length;
      const completedProjects = projects.filter((p) => p.status === 'COMPLETED').length;

      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
      const pendingTasks = totalTasks - completedTasks;

      const statusDistribution: Record<string, number> = {
        BACKLOG: tasks.filter((t) => t.status === 'BACKLOG').length,
        TO_DO: tasks.filter((t) => t.status === 'TO_DO').length,
        IN_PROGRESS: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
        TESTING: tasks.filter((t) => t.status === 'TESTING').length,
        REVIEW: tasks.filter((t) => t.status === 'REVIEW').length,
        COMPLETED: completedTasks,
      };

      const priorityDistribution: Record<string, number> = {
        LOW: tasks.filter((t) => t.priority === 'LOW').length,
        MEDIUM: tasks.filter((t) => t.priority === 'MEDIUM').length,
        HIGH: tasks.filter((t) => t.priority === 'HIGH').length,
        CRITICAL: tasks.filter((t) => t.priority === 'CRITICAL').length,
      };

      const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

      return res.json({
        totalProjects,
        activeProjects,
        completedProjects,
        totalTasks,
        completedTasks,
        pendingTasks,
        statusDistribution,
        priorityDistribution,
        productivityScore,
      });
    } catch (err: any) {
      console.error('Error in getAnalytics:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async downloadPdfReport(req: AuthRequest, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const project = await Project.findByPk(projectId);

      if (!project) return res.status(404).send('Project not found');

      const pdfBuffer = await ReportService.generateProjectPDF(project);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Project_Report_${projectId}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err: any) {
      console.error('Error in downloadPdfReport:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async downloadExcelReport(req: AuthRequest, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const project = await Project.findByPk(projectId);

      if (!project) return res.status(404).send('Project not found');

      const csvContent = ReportService.generateProjectCSV(project);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="Project_Report_${projectId}.csv"`);
      return res.send(csvContent);
    } catch (err: any) {
      console.error('Error in downloadExcelReport:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}
